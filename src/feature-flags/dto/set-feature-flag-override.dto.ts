import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export class SetFeatureFlagOverrideDto extends createZodDto(
  z.strictObject({
    value: z.enum(['grant', 'deny']),
  }),
) {}
