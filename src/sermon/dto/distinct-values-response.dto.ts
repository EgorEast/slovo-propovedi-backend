import { createZodDto } from 'nestjs-zod';
import { SermonControllerGetDistinctValuesResponse } from '../../generated';

export class DistinctValuesResponseDto extends createZodDto(
  SermonControllerGetDistinctValuesResponse,
) {}
