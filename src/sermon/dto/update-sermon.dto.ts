import { createZodDto } from 'nestjs-zod';
import { SermonControllerUpdateBody } from '../../generated';

export class UpdateSermonDto extends createZodDto(SermonControllerUpdateBody) {}
