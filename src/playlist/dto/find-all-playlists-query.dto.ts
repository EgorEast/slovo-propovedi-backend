import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { PlaylistControllerFindAllQueryParams } from '../../generated';

// Query params arrive as strings — `search` is normalized at the boundary:
// trim whitespace, reject empty. `page`/`limit` select the offset-pagination
// mode (no keyset mode exists for playlists, so no exclusivity rule).
const FindAllPlaylistsQuerySchema = PlaylistControllerFindAllQueryParams.extend(
  {
    search: z.string().trim().min(1).optional(),
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
  },
);

export class FindAllPlaylistsQueryDto extends createZodDto(
  FindAllPlaylistsQuerySchema,
) {}
