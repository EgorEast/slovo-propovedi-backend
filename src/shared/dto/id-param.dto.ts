import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export class IdParamDto extends createZodDto(
  z.object({ id: z.string().uuid() }),
) {}
