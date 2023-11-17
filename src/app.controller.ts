import {
  Controller,
  Get,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { AppService } from './app.service';
import { FileInterceptor } from '@nestjs/platform-express';
import { MinioService } from './minio/minio.service';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly minioService: MinioService,
  ) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Post('files')
  @UseInterceptors(FileInterceptor('file'))
  async uploadFile(@UploadedFile() file: Express.Multer.File) {
    try {
      const fileName = await this.minioService.uploadFile(file);
      const fileUrl = await this.minioService.getFileUrl(fileName);
      return {
        fileName,
        fileUrl,
      };
    } catch (error) {
      console.log('Error - ', error.message);
    }
  }

  @Get('files/:fileName')
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
