import { createZodDto } from 'nestjs-zod';
import { FeatureFlagsControllerCreateBody } from '../../generated';

export class CreateFeatureFlagDto extends createZodDto(
  FeatureFlagsControllerCreateBody,
) {}
