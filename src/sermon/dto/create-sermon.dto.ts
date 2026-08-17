import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { SermonControllerCreateBody } from '../../generated';

// A chapter range (chapter: [start, end]) must pair with a verse range or no
// verse at all — a single integer verse cannot be anchored to a chapter range.
const CreateSermonSchema = SermonControllerCreateBody.superRefine(
  (body, ctx) => {
    if (Array.isArray(body.chapter) && typeof body.verse === 'number') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['verse'],
        message: 'verse must be an array or null when chapter is a range',
      });
    }
  },
);

export class CreateSermonDto extends createZodDto(CreateSermonSchema) {}
