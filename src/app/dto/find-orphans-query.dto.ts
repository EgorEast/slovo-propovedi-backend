import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  AppControllerGetOrphanedFilesQueryParams,
  appControllerGetOrphanedFilesQueryLimitDefault,
  appControllerGetOrphanedFilesQueryLimitMax,
} from '../../generated';

// The orphans query arrives as strings — coerce `limit` from string to number.
// The generated schema carries `zod.default(500)`, which would keep the key
// always present but as a raw string; re-specifying the bound here keeps the
// documented default (500) and cap (5000) as the single source of truth from
// the generated constants, while the service always receives a resolved
// number.
const FindOrphansQuerySchema = AppControllerGetOrphanedFilesQueryParams.extend({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(appControllerGetOrphanedFilesQueryLimitMax)
    .default(appControllerGetOrphanedFilesQueryLimitDefault),
});

export class FindOrphansQueryDto extends createZodDto(FindOrphansQuerySchema) {}
