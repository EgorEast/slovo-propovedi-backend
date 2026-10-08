import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { createZodValidationPipe } from 'nestjs-zod';
import { AppModule } from './app.module';
import { MinioService } from './minio/minio.service';
import { SwaggerModule } from '@nestjs/swagger';
import * as yaml from 'js-yaml';
import type { OpenAPIObject } from '@nestjs/swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Hostnames are deployment-specific — no prod defaults. Fail fast on boot.
  const requiredHostname = (envVar: string): string => {
    const value = process.env[envVar];
    if (!value) {
      throw new Error(
        `Environment variable ${envVar} is required but not set (e.g. from Forgejo org vars in production, or .env locally).`,
      );
    }
    return value;
  };
  const landingHostname = requiredHostname('LANDING_HOSTNAME');
  const webHostname = requiredHostname('WEB_HOSTNAME');

  const allowedOrigins = [
    `https://${landingHostname}`,
    `https://www.${landingHostname}`,
    `https://${webHostname}`,
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

  // strictSchemaDeclaration: true throws if any route param is not a Zod DTO
  const StrictZodValidationPipe = createZodValidationPipe({
    strictSchemaDeclaration: true,
  });
  app.useGlobalPipes(new StrictZodValidationPipe());

  const minioService = app.get<MinioService>(MinioService);
  await minioService.createBucketIfNotExists();

  if (process.env.DOCS_ENABLED === 'true') {
    try {
      const specUrl =
        process.env.OPENAPI_SPEC_URL ||
        `https://${requiredHostname('DOCS_HOSTNAME')}/openAPI.yaml`;
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

const bootstrapLogger = new Logger('bootstrap');

// A rejected promise that nobody handles is a programming error, but not one
// that should kill the process — log it and let the request/event loop
// continue (systemd would restart the app anyway, losing in-flight requests).
process.on('unhandledRejection', (reason: unknown) => {
  const message =
    reason instanceof Error ? (reason.stack ?? reason.message) : String(reason);
  bootstrapLogger.warn(`Unhandled promise rejection: ${message}`);
});

// An uncaught exception leaves the process in an undefined state — fail fast
// and let systemd (Restart=always) recover with a clean restart.
process.on('uncaughtException', (error: Error) => {
  bootstrapLogger.error(`Uncaught exception: ${error.stack ?? error.message}`);
  process.exit(1);
});

bootstrap().catch((error: unknown) => {
  const message =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
  bootstrapLogger.error(`Bootstrap failed: ${message}`);
  process.exit(1);
});
