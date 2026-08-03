import { createZodDto } from 'nestjs-zod';
import { SectionControllerRemoveResponse } from '../../generated';

export class StatusSectionResponseDto extends createZodDto(
  SectionControllerRemoveResponse,
) {}
