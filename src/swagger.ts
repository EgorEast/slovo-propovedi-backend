import { DocumentBuilder } from '@nestjs/swagger';

export function buildSwaggerDocumentConfig() {
  return new DocumentBuilder()
    .addBearerAuth()
    .setTitle('API')
    .setDescription('API requests')
    .setVersion('1.0')
    .build();
}
