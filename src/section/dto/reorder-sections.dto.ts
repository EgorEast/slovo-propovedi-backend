import { createZodDto } from 'nestjs-zod';
import { ReorderSectionsBody } from '../../generated';

export class ReorderSectionsDto extends createZodDto(ReorderSectionsBody) {}
