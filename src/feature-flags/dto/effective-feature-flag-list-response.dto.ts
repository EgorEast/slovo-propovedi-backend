import { createZodDto } from 'nestjs-zod';
import { FeatureFlagsControllerGetEffectiveForMeResponse } from '../../generated';

export class EffectiveFeatureFlagListResponseDto extends createZodDto(
  FeatureFlagsControllerGetEffectiveForMeResponse,
) {}
