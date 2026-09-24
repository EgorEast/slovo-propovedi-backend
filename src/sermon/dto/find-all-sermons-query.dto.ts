import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { SermonControllerFindAllQueryParams } from '../../generated';
import { SortOrder } from 'src/shared/sort';

// Sermon list sort keys — the values documented in the spec and enforced by
// the generated enum.
export type SermonSort = 'date' | 'title' | 'artist' | 'playlist';

// Query params arrive as strings — coerce `take` from string to number.
// `search` is normalized at the boundary: trim whitespace, reject empty.
// `cursor` is overridden from the generated zod.uuid(): relevance-ordered
// search pages carry an opaque composite cursor (base64 JSON `{rank, id}`),
// while non-search pages keep the plain uuid id cursor. Old plain-uuid cursors
// are invalidated for search pages (the service rejects them), and a garbage
// cursor on a non-search page is still rejected here at the boundary.
// `page`/`limit` select the offset-pagination mode, which is mutually
// exclusive with the keyset mode (`take`/`cursor`) — the service never sees
// an ambiguous combination.
// `sort`/`order` are overridden from the generated schemas, which carry zod
// defaults (`date` / `desc`). A default would make the key ALWAYS present
// after parsing — the keyset conflict below would then fire on every
// take/cursor request, and the direction default (asc for the alphabetical
// sorts, desc for date) could not be told apart from an explicit `desc`.
// Keep both optional here and resolve the documented defaults in the
// .transform below, so the service only ever sees a resolved combination.
const FindAllSermonsQuerySchema = SermonControllerFindAllQueryParams.extend({
  take: z.coerce.number().int().min(1).max(100).optional(),
  search: z.string().trim().min(1).optional(),
  cursor: z.string().min(1).optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  sort: z.enum(['date', 'title', 'artist', 'playlist']).optional(),
  order: z.enum(['asc', 'desc']).optional(),
})
  .superRefine((query, ctx) => {
    if (
      query.cursor &&
      !query.search &&
      !z.string().uuid().safeParse(query.cursor).success
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['cursor'],
        message: 'cursor must be a valid uuid when search is absent',
      });
    }
    if (
      (query.page !== undefined || query.limit !== undefined) &&
      (query.take !== undefined || query.cursor !== undefined)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['page'],
        message: 'page and limit are mutually exclusive with take and cursor',
      });
    }
    if (
      (query.take !== undefined || query.cursor !== undefined) &&
      (query.sort !== undefined || query.order !== undefined)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sort'],
        message: 'sort and order are mutually exclusive with take and cursor',
      });
    }
  })
  .transform((query) => {
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

export class FindAllSermonsQueryDto extends createZodDto(
  FindAllSermonsQuerySchema,
) {}
