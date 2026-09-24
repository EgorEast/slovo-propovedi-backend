import { createZodDto } from 'nestjs-zod';
import { AppControllerRemoveFileResponse } from '../../generated';

export class StatusFileResponseDto extends createZodDto(
  AppControllerRemoveFileResponse,
) {}
