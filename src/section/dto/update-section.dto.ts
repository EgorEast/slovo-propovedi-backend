import { createZodDto } from 'nestjs-zod';
import { SectionControllerUpdateBody } from '../../generated';

export class UpdateSectionDto extends createZodDto(
  SectionControllerUpdateBody,
) {}
