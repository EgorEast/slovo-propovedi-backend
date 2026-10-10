import { createZodDto } from 'nestjs-zod';
import { FeatureFlagsControllerCreateResponse } from '../../generated';

// FeatureFlagResponseDto is used for both create + update responses — both
// return the same FeatureFlag shape.
export class FeatureFlagResponseDto extends createZodDto(
  FeatureFlagsControllerCreateResponse,
) {}
