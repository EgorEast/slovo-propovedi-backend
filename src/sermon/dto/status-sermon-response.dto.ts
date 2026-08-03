import { createZodDto } from 'nestjs-zod';
import { SermonControllerUpdateResponse } from '../../generated';

// StatusSermonResponseDto is used for both update + remove responses — both have the same shape
export class StatusSermonResponseDto extends createZodDto(
  SermonControllerUpdateResponse,
) {}
