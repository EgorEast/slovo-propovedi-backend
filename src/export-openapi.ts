import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule } from '@nestjs/swagger';
import { dump } from 'js-yaml';
import { AppModule } from './app.module';
import { buildSwaggerDocumentConfig } from './swagger';

/**
 * Exports the OpenAPI spec to openAPI.yaml at the repository root
 * without starting the HTTP server.
 *
 * Usage: npm run export-openapi
 *
 * After exporting, publish the new spec to the standalone Swagger service:
 *   cp ../openAPI.yaml ~/Programming/slovo-propovedi-swagger/openAPI.yaml
 *   cd ~/Programming/slovo-propovedi-swagger
 *   git add openAPI.yaml && git commit -m "chore: update OpenAPI spec" && git push
 *
 * The output path can be overridden with the OPENAPI_OUTPUT_PATH env var.
 * Requires the same environment as the backend (Postgres must be reachable).
 */
async function exportOpenApi(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  try {
    const document = SwaggerModule.createDocument(
      app,
      buildSwaggerDocumentConfig(),
    );
    const outputPath =
      process.env.OPENAPI_OUTPUT_PATH ??
      resolve(__dirname, '..', '..', 'openAPI.yaml');
    writeFileSync(outputPath, dump(document, { noRefs: true }), 'utf8');
    console.log(`OpenAPI spec written to ${outputPath}`);
  } finally {
    await app.close();
  }
}

exportOpenApi()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error('Failed to export OpenAPI spec:', error);
    process.exit(1);
  });
