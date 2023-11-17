import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import * as Minio from 'minio';

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
      const fileName = randomUUID() + '-' + file.originalname;
      await this.minioClient.putObject(
        MinioService.BUCKET_NAME,
        fileName,
        file.buffer,
        file.size,
      );

      return fileName;
    } catch (error) {
      console.log('Error: ', error.message);
    }
  }

  async getFileUrl(fileName: string) {
    return this.minioClient.presignedUrl(
      'GET',
      MinioService.BUCKET_NAME,
      fileName,
    );
  }
}
