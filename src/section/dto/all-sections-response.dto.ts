import { createZodDto } from 'nestjs-zod';
import { SectionControllerFindAllResponse } from '../../generated';

export class AllSectionsResponseDto extends createZodDto(
  SectionControllerFindAllResponse,
) {}
