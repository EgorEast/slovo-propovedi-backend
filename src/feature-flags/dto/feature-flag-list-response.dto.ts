import { createZodDto } from 'nestjs-zod';
import { FeatureFlagsControllerFindAllResponse } from '../../generated';

export class FeatureFlagListResponseDto extends createZodDto(
  FeatureFlagsControllerFindAllResponse,
) {}
