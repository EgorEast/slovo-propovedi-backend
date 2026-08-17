import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { UsersControllerFindAllQueryParams } from '../../generated';

// Query params arrive as strings — coerce `page`/`limit` from string to
// number. Offset pagination only; no keyset mode exists for users.
const FindAllUsersQuerySchema = UsersControllerFindAllQueryParams.extend({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export class FindAllUsersQueryDto extends createZodDto(
  FindAllUsersQuerySchema,
) {}
