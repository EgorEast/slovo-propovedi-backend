import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { createZodValidationPipe } from 'nestjs-zod';
import { AppModule } from './app.module';
import { MinioService } from './minio/minio.service';
import { SwaggerModule } from '@nestjs/swagger';
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
  if (process.env.DOCS_UI_ORIGIN) {
    allowedOrigins.push(process.env.DOCS_UI_ORIGIN);
  }
  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  });

  // ZodValidationPipe runs FIRST: validates Zod DTOs, no-ops on class-validator DTOs
  // ValidationPipe runs SECOND: validates class-validator DTOs, no-ops on Zod
  // This prevents whitelist:true from stripping data before Zod sees it
  // strictSchemaDeclaration: true throws if any route param is not a Zod DTO
  const StrictZodValidationPipe = createZodValidationPipe({
    strictSchemaDeclaration: true,
  });
  app.useGlobalPipes(
    new StrictZodValidationPipe(),
    new ValidationPipe({ transform: true }),
  );

  const minioService = app.get<MinioService>(MinioService);
  await minioService.createBucketIfNotExists();

  if (process.env.DOCS_ENABLED === 'true') {
    try {
      const specUrl =
        process.env.OPENAPI_SPEC_URL ||
        'https://docs.slovo-propovedi.ru/openAPI.yaml';
      const response = await fetch(specUrl);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const yamlText = await response.text();
      const openApiDoc = yaml.load(yamlText) as OpenAPIObject;
      SwaggerModule.setup('swagger-api', app, openApiDoc);
      Logger.log(`Swagger UI loaded from ${specUrl}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      Logger.warn(
        `Failed to load OpenAPI spec for Swagger UI: ${message}. Swagger UI disabled.`,
      );
    }
  }

  await app.listen('3000');
}
bootstrap();
