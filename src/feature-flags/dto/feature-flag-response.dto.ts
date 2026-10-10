import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// Base flag shape reused by FeatureFlagListResponseDto — one shape, one source.
export const featureFlagResponseSchema = z.strictObject({
  id: z.string(),
  key: z.string(),
  title: z.string(),
  enabled: z.boolean(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});

export class FeatureFlagResponseDto extends createZodDto(
  featureFlagResponseSchema,
) {}
