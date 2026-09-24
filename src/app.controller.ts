import {
  BadRequestException,
  ConflictException,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ZodResponse } from 'nestjs-zod';
import { FileInterceptor } from '@nestjs/platform-express';
import { MinioService, ReferencedFileNames } from './minio/minio.service';
import { AuthGuard } from './auth/guard/auth.guard';
import { RolesGuard } from './auth/guard/roles.guard';
import { Roles } from './auth/decorators/roles.decorator';
import { UserRole } from './users/user-role.enum';
import { SermonEntity } from './sermon/entities/sermon.entity';
import { PlaylistEntity } from './playlist/entities/playlist.entity';
import { FileResponseDto } from './app/dto/file-response.dto';
import { FileUploadDto } from './app/dto/file-upload.dto';
import { GetFilesResponseDto } from './app/dto/get-files-response.dto';
import { OrphanedFilesResponseDto } from './app/dto/orphaned-files-response.dto';
import { FindOrphansQueryDto } from './app/dto/find-orphans-query.dto';
import { CleanupOrphansResponseDto } from './app/dto/cleanup-orphans-response.dto';
import { StatusFileResponseDto } from './app/dto/status-file-response.dto';
import { StreamUrlResponseDto } from './app/dto/stream-url-response.dto';
import { FileNameParamDto } from './shared/dto/file-name-param.dto';

@Controller()
export class AppController {
  constructor(
    private readonly minioService: MinioService,
    @InjectRepository(SermonEntity)
    private readonly sermonRepository: Repository<SermonEntity>,
    @InjectRepository(PlaylistEntity)
    private readonly playlistRepository: Repository<PlaylistEntity>,
  ) {}

  @Post('files')
  @Roles(UserRole.Admin, UserRole.Moderator)
  @UseGuards(AuthGuard, RolesGuard)
  @ZodResponse({ type: FileResponseDto })
  @UseInterceptors(FileInterceptor('file'))
  async uploadFile(
    @UploadedFile('file') file: FileUploadDto,
  ): Promise<FileResponseDto> {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }
    // The param is annotated with the ZodDto solely so the strict global pipe
    // accepts it; at runtime it is still the Express.Multer.File produced by
    // FileInterceptor (z.any() is a passthrough).
    const multerFile = file as Express.Multer.File;

    // Reject any extension outside the allow-list before the file is stored.
    const extension = MinioService.getFileExtension(multerFile.originalname);
    if (!MinioService.MEDIA_EXTENSIONS.includes(extension)) {
      throw new BadRequestException(
        'Недопустимый тип файла. Разрешены только: JPEG, PNG, WebP, MP3, PDF, FB2.',
      );
    }

    const fileName = await this.minioService.uploadFile(multerFile);
    const fileUrl = await this.minioService.getFileUrl(fileName);
    return { fileName, fileUrl } as FileResponseDto;
  }

  /**
   * Lists all image files in storage for the cover-reuse feature. Each item
   * carries `used` — whether the image is already referenced as artwork by a
   * sermon or playlist. Protected — the storage inventory must not be exposed
   * to unauthenticated callers. Declared before `GET /files/:fileName` —
   * Express matches routes in order.
   */
  @Get('files')
  @Roles(UserRole.Admin, UserRole.Moderator)
  @UseGuards(AuthGuard, RolesGuard)
  @ZodResponse({ type: GetFilesResponseDto })
  async listFiles(): Promise<GetFilesResponseDto> {
    const referenced = await this.loadReferencedFileNames();
    const storedFiles = await this.minioService.listImages();
    return {
      files: storedFiles.map((file) => ({
        fileName: file.fileName,
        fileUrl: file.fileUrl,
        size: file.size,
        lastModified: file.lastModified
          ? file.lastModified.toISOString()
          : null,
        used: referenced.artwork.has(file.fileName),
      })),
      count: storedFiles.length,
    } as GetFilesResponseDto;
  }

  /**
   * Lists bucket objects (media extensions only) that no sermon/playlist
   * references: audio/text not used as audioUrl/textFileUrl, images not used
   * as artwork. The scan streams and stops once `limit` orphans are collected
   * (default 500, max 5000), so the response and memory are bounded. Static
   * segment — must be declared before `GET /files/:fileName`.
   */
  @Get('files/orphans')
  @Roles(UserRole.Admin, UserRole.Moderator)
  @UseGuards(AuthGuard, RolesGuard)
  @ZodResponse({ type: OrphanedFilesResponseDto })
  async getOrphanedFiles(
    @Query() query: FindOrphansQueryDto,
  ): Promise<OrphanedFilesResponseDto> {
    const referenced = await this.loadReferencedFileNames();
    const orphaned = await this.minioService.listOrphans(
      referenced,
      query.limit,
    );
    return {
      orphaned: orphaned.map((file) => ({
        fileName: file.fileName,
        fileUrl: file.fileUrl,
        size: file.size,
        lastModified: file.lastModified
          ? file.lastModified.toISOString()
          : null,
        // Orphans are unreferenced by definition — the contract fixes the flag.
        used: false,
      })),
      count: orphaned.length,
    } as OrphanedFilesResponseDto;
  }

  /**
   * Idempotent, best-effort cleanup of orphaned AUDIO/TEXT objects only
   * (.mp3/.pdf/.fb2) — images are never deleted here because covers are
   * managed manually from the catalog UI. Per-object failures are collected
   * and reported; one failure never fails the request.
   */
  @Post('files/orphans/cleanup')
  @Roles(UserRole.Admin, UserRole.Moderator)
  @UseGuards(AuthGuard, RolesGuard)
  @ZodResponse({ type: CleanupOrphansResponseDto })
  async cleanupOrphanedFiles(): Promise<CleanupOrphansResponseDto> {
    const referenced = await this.loadReferencedFileNames();
    const storedFiles = await this.minioService.listFilesWithUsage(referenced);
    const audioTextOrphans = storedFiles.filter(
      (file) => !file.used && MinioService.isAudioOrTextFile(file.fileName),
    );

    const deleted: string[] = [];
    const failed: { fileName: string; reason: string }[] = [];
    for (const file of audioTextOrphans) {
      try {
        await this.minioService.removeObjectByName(file.fileName);
        deleted.push(file.fileName);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        failed.push({ fileName: file.fileName, reason });
      }
    }
    return { deleted, failed } as CleanupOrphansResponseDto;
  }

  /**
   * @deprecated Returns a static (non-expiring) URL. Prefer
   * `GET /files/:fileName/stream-url`, which returns a time-limited presigned
   * URL, since the default bucket is private.
   */
  @Get('files/:fileName')
  @ZodResponse({ type: FileResponseDto })
  async getFile(@Param() params: FileNameParamDto): Promise<FileResponseDto> {
    const fileUrl = await this.minioService.getFileUrl(params.fileName);
    return { fileName: params.fileName, fileUrl } as FileResponseDto;
  }

  @Get('files/:fileName/stream-url')
  @ZodResponse({ type: StreamUrlResponseDto })
  async getStreamUrl(
    @Param() params: FileNameParamDto,
  ): Promise<StreamUrlResponseDto> {
    const url = await this.minioService.getPresignedFileUrl(params.fileName);
    return { url } as StreamUrlResponseDto;
  }

  /**
   * Deletes an image object. Refuses non-image extensions (audio/text cleanup
   * belongs to `POST /files/orphans/cleanup`) and returns 409 when the image
   * is referenced as artwork by a sermon or playlist — covers are managed
   * manually and must not disappear under an admin's feet.
   */
  @Delete('files/:fileName')
  @Roles(UserRole.Admin, UserRole.Moderator)
  @UseGuards(AuthGuard, RolesGuard)
  @ZodResponse({ type: StatusFileResponseDto })
  async removeFile(
    @Param() params: FileNameParamDto,
  ): Promise<StatusFileResponseDto> {
    if (!MinioService.isImageFile(params.fileName)) {
      throw new BadRequestException(
        'Удалять можно только изображения (JPEG, PNG, WebP). Аудио и текстовые файлы удаляются через очистку осиротевших файлов.',
      );
    }
    const referenced = await this.loadReferencedFileNames();
    if (referenced.artwork.has(params.fileName)) {
      throw new ConflictException(
        `Изображение "${params.fileName}" используется как обложка проповеди или плейлиста и не может быть удалено`,
      );
    }
    await this.minioService.removeObjectByName(params.fileName);
    return { status: 'success' } as StatusFileResponseDto;
  }

  /**
   * Extracts every referenced file name from the stored URL columns of all
   * sermons and playlists. Malformed/foreign URLs are skipped — one bad row
   * must not break the orphans scan; the object it points to is simply
   * unmatched (and therefore reported as an orphan).
   */
  private async loadReferencedFileNames(): Promise<ReferencedFileNames> {
    const [sermons, playlists] = await Promise.all([
      this.sermonRepository.find({
        select: { audioUrl: true, textFileUrl: true, artwork: true },
      }),
      this.playlistRepository.find({ select: { artwork: true } }),
    ]);

    const audio = new Set<string>();
    const text = new Set<string>();
    const artwork = new Set<string>();
    for (const sermon of sermons) {
      this.collectExtractedName(audio, sermon.audioUrl);
      this.collectExtractedName(text, sermon.textFileUrl);
      this.collectExtractedName(artwork, sermon.artwork);
    }
    for (const playlist of playlists) {
      this.collectExtractedName(artwork, playlist.artwork);
    }
    return { audio, text, artwork };
  }

  private collectExtractedName(
    set: Set<string>,
    fileUrl: string | undefined,
  ): void {
    if (!fileUrl) {
      return;
    }
    try {
      set.add(MinioService.extractFileNameFromUrl(fileUrl));
    } catch {
      // Skipped deliberately — see loadReferencedFileNames().
    }
  }
}
