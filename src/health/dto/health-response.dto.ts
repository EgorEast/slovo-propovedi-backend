import { createZodDto } from 'nestjs-zod';
import { HealthControllerCheckResponse } from '../../generated';

export class HealthResponseDto extends createZodDto(
  HealthControllerCheckResponse,
) {}
