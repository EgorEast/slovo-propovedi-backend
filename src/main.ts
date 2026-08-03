import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { MinioService } from './minio/minio.service';
import { SwaggerModule } from '@nestjs/swagger';
import { buildSwaggerDocumentConfig } from './swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const allowedOrigins = [
    'https://slovo-propovedi.ru',
    'https://www.slovo-propovedi.ru',
    'http://localhost:3000',
    'http://localhost:4321',
    'http://localhost:8081',
    'http://localhost:8082',
  ];
  if (process.env.SWAGGER_UI_ORIGIN) {
    allowedOrigins.push(process.env.SWAGGER_UI_ORIGIN);
  }
  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  const minioService = app.get<MinioService>(MinioService);
  await minioService.createBucketIfNotExists();
  if (process.env.SWAGGER_ENABLED === 'true') {
    const document = SwaggerModule.createDocument(
      app,
      buildSwaggerDocumentConfig(),
    );
    SwaggerModule.setup('swagger-api', app, document);
  }
  await app.listen('3000');
}
bootstrap();
