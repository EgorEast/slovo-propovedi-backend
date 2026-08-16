import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { PlaylistControllerFindAllQueryParams } from '../../generated';

// Query params arrive as strings — `search` is normalized at the boundary:
// trim whitespace, reject empty. Playlists have no pagination, so the DTO
// carries only the optional search term.
const FindAllPlaylistsQuerySchema = PlaylistControllerFindAllQueryParams.extend(
  {
    search: z.string().trim().min(1).optional(),
  },
);

export class FindAllPlaylistsQueryDto extends createZodDto(
  FindAllPlaylistsQuerySchema,
) {}
