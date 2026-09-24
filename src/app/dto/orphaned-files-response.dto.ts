import { createZodDto } from 'nestjs-zod';
import { AppControllerGetOrphanedFilesResponse } from '../../generated';

export class OrphanedFilesResponseDto extends createZodDto(
  AppControllerGetOrphanedFilesResponse,
) {}
