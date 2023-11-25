import {
  Controller,
  Get,
  HttpStatus,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { AppService } from './app.service';
import { FileInterceptor } from '@nestjs/platform-express';
import { MinioService } from './minio/minio.service';
import {
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiProperty,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

class IFileResponseDto {
  @ApiProperty()
  fileName: string;
  @ApiProperty()
  fileUrl: string;
}

@Controller()
@ApiTags('Files')
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly minioService: MinioService,
  ) {}

  @Post('files')
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
  async uploadFile(@UploadedFile('file') file) {
    console.log(file);
    try {
      const fileName = await this.minioService.uploadFile(file);
      const fileUrl = await this.minioService.getFileUrl(fileName);
      return {
        fileName,
        fileUrl,
      } as IFileResponseDto;
    } catch (error) {
      console.log('Error - ', error.message);
    }
  }

  @Get('files/:fileName')
  @ApiOperation({
    summary: 'Get file',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    type: IFileResponseDto,
  })
  async getFile(@Param('fileName') fileName: string) {
    try {
      const fileUrl = await this.minioService.getFileUrl(fileName);
      if (fileUrl) {
        return {
          fileName,
          fileUrl,
        };
      }
    } catch (error) {
      console.log('Error - ', error.message);
    }
  }
}
