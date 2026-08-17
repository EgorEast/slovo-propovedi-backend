import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { SermonControllerUpdateBody } from '../../generated';
import { CHAPTER_RANGE_VERSE_MESSAGE, isVerseRange } from './verse-range';

const UpdateSermonSchema = SermonControllerUpdateBody.superRefine(
  (body, ctx) => {
    if (
      Array.isArray(body.chapter) &&
      body.verse !== undefined &&
      body.verse !== null &&
      !isVerseRange(body.verse)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['verse'],
        message: CHAPTER_RANGE_VERSE_MESSAGE,
      });
    }
  },
);

export class UpdateSermonDto extends createZodDto(UpdateSermonSchema) {}
