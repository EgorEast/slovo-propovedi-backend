import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { MinioService } from './minio/minio.service';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  const minioService = app.get<MinioService>(MinioService);
  await minioService.createBucketIfNotExists();
  const config = new DocumentBuilder()
    .addBearerAuth()
    .setTitle('API')
    .setDescription('API requests')
    .setVersion('1.0')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('swagger-api', app, document);
  await app.listen('3000');
}
bootstrap();
