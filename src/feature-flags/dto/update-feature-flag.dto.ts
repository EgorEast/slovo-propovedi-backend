import { createZodDto } from 'nestjs-zod';
import { FeatureFlagsControllerUpdateBody } from '../../generated';

export class UpdateFeatureFlagDto extends createZodDto(
  FeatureFlagsControllerUpdateBody,
) {}
