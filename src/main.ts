import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ZodValidationPipe } from 'nestjs-zod';
import { AppModule } from './app.module';
import { MinioService } from './minio/minio.service';
import { SwaggerModule } from '@nestjs/swagger';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import type { OpenAPIObject } from '@nestjs/swagger';

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

  // ZodValidationPipe runs FIRST: validates Zod DTOs, no-ops on class-validator DTOs
  // ValidationPipe runs SECOND: validates class-validator DTOs, no-ops on Zod
  // This prevents whitelist:true from stripping data before Zod sees it
  app.useGlobalPipes(
    new ZodValidationPipe(),
    new ValidationPipe({ whitelist: true, transform: true }),
  );

  const minioService = app.get<MinioService>(MinioService);
  await minioService.createBucketIfNotExists();

  if (process.env.SWAGGER_ENABLED === 'true') {
    // Load the hand-written OpenAPI spec from repo root
    const yamlPath = path.join(__dirname, '..', '..', 'openAPI.yaml');
    const openApiDoc = yaml.load(fs.readFileSync(yamlPath, 'utf8')) as OpenAPIObject;
    SwaggerModule.setup('swagger-api', app, openApiDoc);
  }

  await app.listen('3000');
}
bootstrap();
