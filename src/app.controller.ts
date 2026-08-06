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
import { StreamUrlResponseDto } from './app/dto/stream-url-response.dto';
import { FileNameParamDto } from './shared/dto/file-name-param.dto';

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
    const fileName = await this.minioService.uploadFile(
      file as Express.Multer.File,
    );
    const fileUrl = await this.minioService.getFileUrl(fileName);
    return { fileName, fileUrl } as FileResponseDto;
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
