import { createZodDto } from 'nestjs-zod';
import { FeatureFlagsControllerSetOverrideParams } from '../../generated';

// Used for both the PUT and DELETE override routes — both target the same
// (flag id, user id) pair and share one generated params shape.
export class FeatureFlagOverrideParamsDto extends createZodDto(
  FeatureFlagsControllerSetOverrideParams,
) {}
