import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { effectiveFeatureFlagSchema } from './effective-feature-flag.dto';

export class EffectiveFeatureFlagListResponseDto extends createZodDto(
  z.strictObject({
    flags: z.array(effectiveFeatureFlagSchema),
  }),
) {}
