import { createZodDto } from 'nestjs-zod';
import { PlaylistControllerFindAllResponse } from '../../generated';

export class AllPlaylistsResponseDto extends createZodDto(
  PlaylistControllerFindAllResponse,
) {}
