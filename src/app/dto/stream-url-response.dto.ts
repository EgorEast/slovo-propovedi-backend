import { createZodDto } from 'nestjs-zod';
import { AppControllerGetStreamUrlResponse } from '../../generated';

export class StreamUrlResponseDto extends createZodDto(
  AppControllerGetStreamUrlResponse,
) {}
