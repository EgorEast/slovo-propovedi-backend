import { createZodDto } from 'nestjs-zod';
import { SermonControllerCreateResponse } from '../../generated';

// SermonResponseDto is used for both create + findOne responses — both return SermonEntity shape
export class SermonResponseDto extends createZodDto(
  SermonControllerCreateResponse,
) {}
