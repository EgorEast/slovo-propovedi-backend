import { createZodDto } from 'nestjs-zod';
import { PlaylistControllerRemoveResponse } from '../../generated';

export class StatusPlaylistResponseDto extends createZodDto(
  PlaylistControllerRemoveResponse,
) {}
