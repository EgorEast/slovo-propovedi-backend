import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { featureFlagResponseSchema } from './feature-flag-response.dto';

export class FeatureFlagListResponseDto extends createZodDto(
  z.strictObject({
    flags: z.array(featureFlagResponseSchema),
  }),
) {}
