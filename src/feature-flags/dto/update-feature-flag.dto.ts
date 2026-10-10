import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export class UpdateFeatureFlagDto extends createZodDto(
  z.strictObject({
    key: z
      .string()
      .regex(/^[a-z][a-z0-9-]*$/)
      .optional(),
    title: z.string().min(1).optional(),
    enabled: z.boolean().optional(),
  }),
) {}
