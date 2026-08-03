import { createZodDto } from 'nestjs-zod';
import { PlaylistControllerUpdateBody } from '../../generated';

export class UpdatePlaylistDto extends createZodDto(
  PlaylistControllerUpdateBody,
) {}
