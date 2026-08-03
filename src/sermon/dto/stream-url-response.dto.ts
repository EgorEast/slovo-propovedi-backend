import { createZodDto } from 'nestjs-zod';
import { SermonControllerGetStreamUrlResponse } from '../../generated';

export class StreamUrlResponseDto extends createZodDto(
  SermonControllerGetStreamUrlResponse,
) {}
