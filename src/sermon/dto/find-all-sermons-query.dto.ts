import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { SermonControllerFindAllQueryParams } from '../../generated';

// Query params arrive as strings — coerce `take` from string to number.
// `cursor` is already zod.uuid() which accepts strings natively.
// `search` is normalized at the boundary: trim whitespace, reject empty.
const FindAllSermonsQuerySchema = SermonControllerFindAllQueryParams.extend({
  take: z.coerce.number().int().min(1).max(100).optional(),
  search: z.string().trim().min(1).optional(),
});

export class FindAllSermonsQueryDto extends createZodDto(
  FindAllSermonsQuerySchema,
) {}
