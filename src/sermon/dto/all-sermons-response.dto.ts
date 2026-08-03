import { createZodDto } from 'nestjs-zod';
import { SermonControllerFindAllResponse } from '../../generated';

export class AllSermonsResponseDto extends createZodDto(
  SermonControllerFindAllResponse,
) {}
