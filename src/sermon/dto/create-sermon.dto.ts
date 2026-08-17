import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { SermonControllerCreateBody } from '../../generated';

// A verse range is exactly two integers — the only verse shape that can be
// anchored to a chapter range. A single integer or a segments array
// ([[9,18],20]) cannot be anchored to a chapter range.
const isVerseRange = (verse: unknown): verse is [number, number] =>
  Array.isArray(verse) &&
  verse.length === 2 &&
  verse.every((value) => typeof value === 'number');

const CreateSermonSchema = SermonControllerCreateBody.superRefine(
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
        message:
          'verse must be a two-integer range or null when chapter is a range',
      });
    }
  },
);

export class CreateSermonDto extends createZodDto(CreateSermonSchema) {}
