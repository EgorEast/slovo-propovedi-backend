import { createZodDto } from 'nestjs-zod';
import { AppControllerUploadFileResponse } from '../../generated';

export class FileResponseDto extends createZodDto(
  AppControllerUploadFileResponse,
) {}
