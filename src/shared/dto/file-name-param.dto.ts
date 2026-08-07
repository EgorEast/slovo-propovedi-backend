import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export class FileNameParamDto extends createZodDto(
  z.object({ fileName: z.string() }),
) {}
