import { createZodDto } from 'nestjs-zod';
import { FeatureFlagsControllerFindOverridesResponse } from '../../generated';

export class FeatureFlagOverrideListResponseDto extends createZodDto(
  FeatureFlagsControllerFindOverridesResponse,
) {}
