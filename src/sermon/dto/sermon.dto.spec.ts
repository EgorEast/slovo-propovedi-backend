import { CreateSermonDto } from './create-sermon.dto';
import { UpdateSermonDto } from './update-sermon.dto';

// The create/update schemas require every non-scripture field, so a shared
// valid base body keeps each case focused on the chapter/verse cross-field
// rule. chapter/verse are optional — a book-only payload is valid.
const baseBody = {
  title: 'Проповедь',
  description: '',
  textFileUrl: null,
  audioUrl: null,
  youtubeUrl: null,
  artist: 'Автор',
  artwork: '',
  book: 'Иоанна',
};

const RANGE_WITH_INVALID_VERSE_MESSAGE =
  'verse must be a two-integer range or null when chapter is a range';

describe('Sermon DTO chapter-range rule', () => {
  describe('CreateSermonDto', () => {
    it('rejects a chapter range paired with a single verse', () => {
      const result = CreateSermonDto.schema.safeParse({
        ...baseBody,
        chapter: [3, 4],
        verse: 16,
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              path: ['verse'],
              message: RANGE_WITH_INVALID_VERSE_MESSAGE,
            }),
          ]),
        );
      }
    });

    it('rejects a chapter range paired with verse segments', () => {
      const result = CreateSermonDto.schema.safeParse({
        ...baseBody,
        chapter: [1, 2],
        verse: [[9, 18], 20],
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              path: ['verse'],
              message: RANGE_WITH_INVALID_VERSE_MESSAGE,
            }),
          ]),
        );
      }
    });

    it('accepts a chapter range paired with a verse range', () => {
      const result = CreateSermonDto.schema.safeParse({
        ...baseBody,
        chapter: [3, 4],
        verse: [16, 2],
      });
      expect(result.success).toBe(true);
    });

    it('accepts a chapter range with a null verse', () => {
      const result = CreateSermonDto.schema.safeParse({
        ...baseBody,
        chapter: [1, 2],
        verse: null,
      });
      expect(result.success).toBe(true);
    });

    it('accepts a chapter range without a verse key', () => {
      const result = CreateSermonDto.schema.safeParse({
        ...baseBody,
        chapter: [1, 2],
      });
      expect(result.success).toBe(true);
    });

    it('accepts a single chapter with a single verse', () => {
      const result = CreateSermonDto.schema.safeParse({
        ...baseBody,
        chapter: 3,
        verse: 16,
      });
      expect(result.success).toBe(true);
    });

    it('accepts a single chapter with verse segments', () => {
      const result = CreateSermonDto.schema.safeParse({
        ...baseBody,
        chapter: 1,
        verse: [[9, 18], 20],
      });
      expect(result.success).toBe(true);
    });

    it('accepts a book-only payload without chapter/verse keys', () => {
      const result = CreateSermonDto.schema.safeParse(baseBody);
      expect(result.success).toBe(true);
    });
  });

  describe('UpdateSermonDto', () => {
    it('rejects a chapter range paired with a single verse', () => {
      const result = UpdateSermonDto.schema.safeParse({
        ...baseBody,
        chapter: [3, 4],
        verse: 16,
        playlistsIds: [],
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              path: ['verse'],
              message: RANGE_WITH_INVALID_VERSE_MESSAGE,
            }),
          ]),
        );
      }
    });

    it('rejects a chapter range paired with verse segments', () => {
      const result = UpdateSermonDto.schema.safeParse({
        ...baseBody,
        chapter: [1, 2],
        verse: [[9, 18], 20],
        playlistsIds: [],
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              path: ['verse'],
              message: RANGE_WITH_INVALID_VERSE_MESSAGE,
            }),
          ]),
        );
      }
    });

    it('accepts a chapter range paired with a verse range', () => {
      const result = UpdateSermonDto.schema.safeParse({
        ...baseBody,
        chapter: [3, 4],
        verse: [16, 2],
        playlistsIds: [],
      });
      expect(result.success).toBe(true);
    });

    it('accepts a chapter range with a null verse', () => {
      const result = UpdateSermonDto.schema.safeParse({
        ...baseBody,
        chapter: [1, 2],
        verse: null,
        playlistsIds: [],
      });
      expect(result.success).toBe(true);
    });

    it('accepts a chapter range without a verse key', () => {
      const result = UpdateSermonDto.schema.safeParse({
        ...baseBody,
        chapter: [1, 2],
        playlistsIds: [],
      });
      expect(result.success).toBe(true);
    });

    it('accepts a book-only payload without chapter/verse keys', () => {
      const result = UpdateSermonDto.schema.safeParse({
        ...baseBody,
        playlistsIds: [],
      });
      expect(result.success).toBe(true);
    });
  });
});
