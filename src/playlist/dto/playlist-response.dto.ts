import { createZodDto } from 'nestjs-zod';
import { PlaylistControllerCreateResponse } from '../../generated';

export class PlaylistResponseDto extends createZodDto(
  PlaylistControllerCreateResponse,
) {}
