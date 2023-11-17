import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { MinioService } from './minio/minio.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const minioService = app.get<MinioService>(MinioService);
  await minioService.createBucketIfNotExists();
  await app.listen('3000');
}
bootstrap();
