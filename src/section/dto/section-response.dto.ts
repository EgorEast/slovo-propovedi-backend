import { createZodDto } from 'nestjs-zod';
import { SectionControllerCreateResponse } from '../../generated';

export class SectionResponseDto extends createZodDto(
  SectionControllerCreateResponse,
) {}
