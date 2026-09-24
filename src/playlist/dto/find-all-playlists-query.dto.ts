import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { PlaylistControllerFindAllQueryParams } from '../../generated';
import { SortOrder } from 'src/shared/sort';

// Playlist list sort keys — the values documented in the spec and enforced by
// the generated enum.
export type PlaylistSort = 'date' | 'title' | 'section';

// Query params arrive as strings — `search` is normalized at the boundary:
// trim whitespace, reject empty. `page`/`limit` select the offset-pagination
// mode (no keyset mode exists for playlists, so no exclusivity rule).
// `sort`/`order` are overridden from the generated schemas, which carry zod
// defaults (`date` / `desc`) — the direction default is directional in the
// spec (asc for title/section, desc for date), so the DTO must be able to
// tell "order not sent" apart from an explicit `desc`. Keep both optional and
// resolve the documented defaults in the .transform below.
const FindAllPlaylistsQuerySchema = PlaylistControllerFindAllQueryParams.extend(
  {
    search: z.string().trim().min(1).optional(),
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    sort: z.enum(['date', 'title', 'section']).optional(),
    order: z.enum(['asc', 'desc']).optional(),
  },
).transform((query) => {
  // Resolve the documented defaults at the boundary: sort defaults to date,
  // order defaults directionally — desc for date, asc for the alphabetical
  // sorts. The direction reads the RESOLVED sort (not the raw input), so an
  // absent sort still resolves to desc. The service never sees an unresolved
  // combination.
  const sort = query.sort ?? 'date';
  return {
    ...query,
    sort,
    order: (query.order ?? (sort === 'date' ? 'desc' : 'asc')) as SortOrder,
  };
});

export class FindAllPlaylistsQueryDto extends createZodDto(
  FindAllPlaylistsQuerySchema,
) {}
