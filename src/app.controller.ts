import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ZodResponse } from 'nestjs-zod';
import { FileInterceptor } from '@nestjs/platform-express';
import { MinioService } from './minio/minio.service';
import { AuthGuard } from './auth/guard/auth.guard';
import { FileResponseDto } from './app/dto/file-response.dto';
import { FileUploadDto } from './app/dto/file-upload.dto';
import { GetFilesResponseDto } from './app/dto/get-files-response.dto';
import { StreamUrlResponseDto } from './app/dto/stream-url-response.dto';
import { FileNameParamDto } from './shared/dto/file-name-param.dto';

// Uploads are restricted to these extensions; anything else is rejected at
// the boundary before the file reaches storage.
const ALLOWED_FILE_EXTENSIONS = [
  '.jpeg',
  '.jpg',
  '.png',
  '.webp',
  '.mp3',
  '.pdf',
  '.fb2',
];

// Extracts the lowercased extension (with the leading dot) from a file name.
// Names without a dot have no extension and yield an empty string.
function getFileExtension(fileName: string): string {
  const dotIndex = fileName.lastIndexOf('.');
  return dotIndex === -1 ? '' : fileName.slice(dotIndex).toLowerCase();
}

@Controller()
export class AppController {
  constructor(private readonly minioService: MinioService) {}

  @Post('files')
  @UseGuards(AuthGuard)
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
    const extension = getFileExtension(multerFile.originalname);
    if (!ALLOWED_FILE_EXTENSIONS.includes(extension)) {
      throw new BadRequestException(
        'Недопустимый тип файла. Разрешены только: JPEG, PNG, WebP, MP3, PDF, FB2.',
      );
    }

    const fileName = await this.minioService.uploadFile(multerFile);
    const fileUrl = await this.minioService.getFileUrl(fileName);
    return { fileName, fileUrl } as FileResponseDto;
  }

  /**
   * Lists all image files in storage for the cover-reuse feature. Protected —
   * the storage inventory must not be exposed to unauthenticated callers.
   * Declared before `GET /files/:fileName` — Express matches routes in order.
   */
  @Get('files')
  @UseGuards(AuthGuard)
  @ZodResponse({ type: GetFilesResponseDto })
  async listFiles(): Promise<GetFilesResponseDto> {
    const storedFiles = await this.minioService.listImages();
    return {
      files: storedFiles.map((file) => ({
        fileName: file.fileName,
        fileUrl: file.fileUrl,
        size: file.size,
        lastModified: file.lastModified
          ? file.lastModified.toISOString()
          : null,
      })),
      count: storedFiles.length,
    } as GetFilesResponseDto;
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
}
