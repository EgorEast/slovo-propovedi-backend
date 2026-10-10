import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// Feature keys are lowercase kebab-case identifiers shared with the client.
export class CreateFeatureFlagDto extends createZodDto(
  z.strictObject({
    key: z.string().regex(/^[a-z][a-z0-9-]*$/),
    title: z.string().min(1),
  }),
) {}
