import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export class FeatureFlagOverrideParamsDto extends createZodDto(
  z.strictObject({
    id: z.string().uuid(),
    userId: z.string().uuid(),
  }),
) {}
