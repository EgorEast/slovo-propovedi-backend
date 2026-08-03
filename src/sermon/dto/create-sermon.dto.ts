import { createZodDto } from 'nestjs-zod';
import { SermonControllerCreateBody } from '../../generated';

export class CreateSermonDto extends createZodDto(SermonControllerCreateBody) {}
