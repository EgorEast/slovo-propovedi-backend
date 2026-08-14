import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { SermonControllerFindAllQueryParams } from '../../generated';

// Query params arrive as strings — coerce `take` from string to number.
// `search` is normalized at the boundary: trim whitespace, reject empty.
// `cursor` is overridden from the generated zod.uuid(): relevance-ordered
// search pages carry an opaque composite cursor (base64 JSON `{rank, id}`),
// while non-search pages keep the plain uuid id cursor. Old plain-uuid cursors
// are invalidated for search pages (the service rejects them), and a garbage
// cursor on a non-search page is still rejected here at the boundary.
const FindAllSermonsQuerySchema = SermonControllerFindAllQueryParams.extend({
  take: z.coerce.number().int().min(1).max(100).optional(),
  search: z.string().trim().min(1).optional(),
  cursor: z.string().min(1).optional(),
}).superRefine((query, ctx) => {
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
});

export class FindAllSermonsQueryDto extends createZodDto(
  FindAllSermonsQuerySchema,
) {}
