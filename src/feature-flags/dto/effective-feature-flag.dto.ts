import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// Reused by EffectiveFeatureFlagListResponseDto — the resolved value the client
// consumes, independent of how (global default + override) it was derived.
export const effectiveFeatureFlagSchema = z.strictObject({
  key: z.string(),
  enabled: z.boolean(),
});

export class EffectiveFeatureFlagDto extends createZodDto(
  effectiveFeatureFlagSchema,
) {}
