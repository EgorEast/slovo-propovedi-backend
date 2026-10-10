import { createZodDto } from 'nestjs-zod';
import { FeatureFlagsControllerSetOverrideBody } from '../../generated';

export class SetFeatureFlagOverrideDto extends createZodDto(
  FeatureFlagsControllerSetOverrideBody,
) {}
