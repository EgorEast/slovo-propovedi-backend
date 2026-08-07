import { createZodDto } from 'nestjs-zod';
import { ReorderPlaylistsInSectionBody } from '../../generated';

export class ReorderPlaylistsInSectionDto extends createZodDto(
  ReorderPlaylistsInSectionBody,
) {}
