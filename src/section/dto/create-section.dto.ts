import { createZodDto } from 'nestjs-zod';
import { SectionControllerCreateBody } from '../../generated';

export class CreateSectionDto extends createZodDto(
  SectionControllerCreateBody,
) {}
