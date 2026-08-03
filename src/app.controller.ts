import {
  BadRequestException,
  Controller,
  Get,
  HttpStatus,
  Param,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AppService } from './app.service';
import { FileInterceptor } from '@nestjs/platform-express';
import { MinioService } from './minio/minio.service';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiProperty,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AuthGuard } from './auth/guard/auth.guard';

class IFileResponseDto {
  @ApiProperty()
  fileName: string;
  @ApiProperty()
  fileUrl: string;
}

class StreamUrlResponseDto {
  @ApiProperty()
  url: string;
}

@Controller()
@ApiTags('Files')
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly minioService: MinioService,
  ) {}

  @Post('files')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Upload file',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  @UseInterceptors(FileInterceptor('file'))
  @ApiResponse({
    status: HttpStatus.OK,
    type: IFileResponseDto,
  })
  async uploadFile(
    @UploadedFile('file') file: Express.Multer.File,
  ): Promise<IFileResponseDto> {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }
    const fileName = await this.minioService.uploadFile(file);
    const fileUrl = await this.minioService.getFileUrl(fileName);
    return {
      fileName,
      fileUrl,
    };
  }

  /**
   * @deprecated Returns a static (non-expiring) URL. Prefer
   * `GET /files/:fileName/stream-url`, which returns a time-limited presigned
   * URL, since the default bucket is private.
   */
  @Get('files/:fileName')
  @ApiOperation({
    summary: 'Get file',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    type: IFileResponseDto,
  })
  async getFile(
    @Param('fileName') fileName: string,
  ): Promise<IFileResponseDto> {
    const fileUrl = await this.minioService.getFileUrl(fileName);
    return {
      fileName,
      fileUrl,
    };
  }

  @Get('files/:fileName/stream-url')
  @ApiOperation({
    summary: 'Get a presigned streaming URL for a file',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    type: StreamUrlResponseDto,
  })
  async getStreamUrl(
    @Param('fileName') fileName: string,
  ): Promise<StreamUrlResponseDto> {
    const url = await this.minioService.getPresignedFileUrl(fileName);
    return { url };
  }
}
