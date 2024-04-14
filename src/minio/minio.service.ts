import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import * as Minio from 'minio';
import * as path from 'path';

@Injectable()
export class MinioService {
  private minioClient: Minio.Client;
  private static readonly BUCKET_NAME = 'files';

  constructor(private readonly configService: ConfigService) {
    console.log('CCCCCCC - ', this.configService.get('MINIO_ENDPOINT'));
    this.minioClient = new Minio.Client({
      endPoint: this.configService.get('MINIO_ENDPOINT'),
      port: +this.configService.get('MINIO_MAIN_PORT_IN'),
      useSSL: false,
      accessKey: this.configService.get('MINIO_ACCESS_KEY'),
      secretKey: this.configService.get('MINIO_SECRET_KEY'),
    });
  }

  async createBucketIfNotExists(): Promise<void> {
    const bucketExists = await this.minioClient.bucketExists(
      MinioService.BUCKET_NAME,
    );
    if (!bucketExists) {
      await this.minioClient.makeBucket(MinioService.BUCKET_NAME, 'us-east-1');
    }
  }

  async uploadFile(file: Express.Multer.File) {
    try {
      const fileType = path.extname(file.originalname);
      const contentType = this.getContentType(fileType);
      const fileName = randomUUID() + fileType;
      await this.minioClient.putObject(
        MinioService.BUCKET_NAME,
        fileName,
        file.buffer,
        file.size,
        {
          'Content-Type': contentType,
        },
      );

      return fileName;
    } catch (error) {
      console.log('Error: ', error.message);
    }
  }

  async getFileUrl(fileName: string): Promise<string> {
    return `${this.configService.get('MINIO_PUBLIC_URI')}/${
      MinioService.BUCKET_NAME
    }/${fileName}`;
  }

  getContentType(fileType: string): string {
    switch (fileType) {
      case '.jpeg': {
        return 'image/jpeg';
      }
      case '.jpg': {
        return 'image/jpeg';
      }
      case '.png': {
        return 'image/png';
      }
      case '.webp': {
        return 'image/webp';
      }
      case '.mp3': {
        return 'audio/mp3';
      }
    }
  }
}
