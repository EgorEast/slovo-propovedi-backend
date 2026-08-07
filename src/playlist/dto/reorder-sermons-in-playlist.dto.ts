import { createZodDto } from 'nestjs-zod';
import { ReorderSermonsInPlaylistBody } from '../../generated';

export class ReorderSermonsInPlaylistDto extends createZodDto(
  ReorderSermonsInPlaylistBody,
) {}
