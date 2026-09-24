import { FindAllSermonsQueryDto } from './find-all-sermons-query.dto';

const UUID = '123e4567-e89b-12d3-a456-426614174000';

const PAGE_TAKE_EXCLUSIVITY_MESSAGE =
  'page and limit are mutually exclusive with take and cursor';

const SORT_KEYSET_EXCLUSIVITY_MESSAGE =
  'sort and order are mutually exclusive with take and cursor';

describe('FindAllSermonsQueryDto (offset vs keyset exclusivity)', () => {
  it('accepts the keyset mode (take/cursor) without page', () => {
    const result = FindAllSermonsQueryDto.schema.safeParse({
      take: '10',
      cursor: UUID,
    });
    expect(result.success).toBe(true);
  });

  it('accepts the offset mode (page/limit) without take/cursor', () => {
    const result = FindAllSermonsQueryDto.schema.safeParse({
      page: '2',
      limit: '20',
    });
    expect(result.success).toBe(true);
  });

  it('accepts limit without page (page defaults to 1 in the service)', () => {
    const result = FindAllSermonsQueryDto.schema.safeParse({ limit: '20' });
    expect(result.success).toBe(true);
  });

  it('accepts page without limit (limit defaults to the max in the service)', () => {
    const result = FindAllSermonsQueryDto.schema.safeParse({ page: '2' });
    expect(result.success).toBe(true);
  });

  it('accepts search combined with the offset mode (search does not interact with the exclusivity rule)', () => {
    const result = FindAllSermonsQueryDto.schema.safeParse({
      search: 'grace',
      page: '2',
      limit: '20',
    });
    expect(result.success).toBe(true);
  });

  it('rejects page combined with take', () => {
    const result = FindAllSermonsQueryDto.schema.safeParse({
      page: '1',
      take: '10',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: ['page'],
            message: PAGE_TAKE_EXCLUSIVITY_MESSAGE,
          }),
        ]),
      );
    }
  });

  it('rejects page combined with cursor', () => {
    const result = FindAllSermonsQueryDto.schema.safeParse({
      page: '1',
      cursor: UUID,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: ['page'],
            message: PAGE_TAKE_EXCLUSIVITY_MESSAGE,
          }),
        ]),
      );
    }
  });

  it('rejects page combined with both take and cursor', () => {
    const result = FindAllSermonsQueryDto.schema.safeParse({
      page: '1',
      take: '10',
      cursor: UUID,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: ['page'],
            message: PAGE_TAKE_EXCLUSIVITY_MESSAGE,
          }),
        ]),
      );
    }
  });

  it('rejects limit combined with take', () => {
    const result = FindAllSermonsQueryDto.schema.safeParse({
      limit: '20',
      take: '10',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: ['page'],
            message: PAGE_TAKE_EXCLUSIVITY_MESSAGE,
          }),
        ]),
      );
    }
  });

  it('rejects limit combined with cursor', () => {
    const result = FindAllSermonsQueryDto.schema.safeParse({
      limit: '20',
      cursor: UUID,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: ['page'],
            message: PAGE_TAKE_EXCLUSIVITY_MESSAGE,
          }),
        ]),
      );
    }
  });

  it('coerces page/limit from strings to numbers', () => {
    const result = FindAllSermonsQueryDto.schema.safeParse({
      page: '3',
      limit: '15',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(3);
      expect(result.data.limit).toBe(15);
    }
  });

  it('rejects a limit above the schema maximum', () => {
    const result = FindAllSermonsQueryDto.schema.safeParse({ limit: '101' });
    expect(result.success).toBe(false);
  });

  it('rejects a page below 1', () => {
    const result = FindAllSermonsQueryDto.schema.safeParse({ page: '0' });
    expect(result.success).toBe(false);
  });

  describe('sort/order (offset and full-fetch only)', () => {
    it('accepts sort with the offset mode and keeps the client value', () => {
      const result = FindAllSermonsQueryDto.schema.safeParse({
        page: '1',
        limit: '20',
        sort: 'title',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.sort).toBe('title');
      }
    });

    it('accepts sort/order with a full fetch (no pagination params)', () => {
      const result = FindAllSermonsQueryDto.schema.safeParse({
        sort: 'artist',
        order: 'desc',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.sort).toBe('artist');
        expect(result.data.order).toBe('desc');
      }
    });

    it('resolves sort to date and order to desc when both are absent', () => {
      const result = FindAllSermonsQueryDto.schema.safeParse({});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.sort).toBe('date');
        expect(result.data.order).toBe('desc');
      }
    });

    it('resolves the direction default directionally: asc for alphabetical sorts', () => {
      const result = FindAllSermonsQueryDto.schema.safeParse({ sort: 'title' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.sort).toBe('title');
        expect(result.data.order).toBe('asc');
      }
    });

    it('keeps date sort paired with the desc direction default', () => {
      const result = FindAllSermonsQueryDto.schema.safeParse({ sort: 'date' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.sort).toBe('date');
        expect(result.data.order).toBe('desc');
      }
    });

    it('accepts search combined with sort (search wins in the service)', () => {
      const result = FindAllSermonsQueryDto.schema.safeParse({
        search: 'grace',
        sort: 'title',
        order: 'asc',
      });
      expect(result.success).toBe(true);
    });

    it('rejects an unknown sort value', () => {
      const result = FindAllSermonsQueryDto.schema.safeParse({
        sort: 'relevance',
      });
      expect(result.success).toBe(false);
    });

    it('rejects an unknown order value', () => {
      const result = FindAllSermonsQueryDto.schema.safeParse({ order: 'up' });
      expect(result.success).toBe(false);
    });

    it('rejects sort combined with take', () => {
      const result = FindAllSermonsQueryDto.schema.safeParse({
        take: '10',
        sort: 'title',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              path: ['sort'],
              message: SORT_KEYSET_EXCLUSIVITY_MESSAGE,
            }),
          ]),
        );
      }
    });

    it('rejects sort combined with cursor', () => {
      const result = FindAllSermonsQueryDto.schema.safeParse({
        cursor: UUID,
        sort: 'title',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              path: ['sort'],
              message: SORT_KEYSET_EXCLUSIVITY_MESSAGE,
            }),
          ]),
        );
      }
    });

    it('rejects order combined with take', () => {
      const result = FindAllSermonsQueryDto.schema.safeParse({
        take: '10',
        order: 'asc',
      });
      expect(result.success).toBe(false);
    });

    it('rejects order combined with cursor', () => {
      const result = FindAllSermonsQueryDto.schema.safeParse({
        cursor: UUID,
        order: 'desc',
      });
      expect(result.success).toBe(false);
    });

    it('rejects sort and order combined with take and cursor together', () => {
      const result = FindAllSermonsQueryDto.schema.safeParse({
        take: '10',
        cursor: UUID,
        sort: 'playlist',
        order: 'asc',
      });
      expect(result.success).toBe(false);
    });
  });
});
