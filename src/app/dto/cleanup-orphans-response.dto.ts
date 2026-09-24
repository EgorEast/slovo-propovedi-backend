import { createZodDto } from 'nestjs-zod';
import { AppControllerCleanupOrphanedFilesResponse } from '../../generated';

export class CleanupOrphansResponseDto extends createZodDto(
  AppControllerCleanupOrphanedFilesResponse,
) {}
