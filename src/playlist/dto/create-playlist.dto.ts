import { createZodDto } from 'nestjs-zod';
import { PlaylistControllerCreateBody } from '../../generated';

export class CreatePlaylistDto extends createZodDto(
  PlaylistControllerCreateBody,
) {}
