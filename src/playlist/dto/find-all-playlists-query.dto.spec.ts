import { FindAllPlaylistsQueryDto } from './find-all-playlists-query.dto';

describe('FindAllPlaylistsQueryDto (offset pagination)', () => {
  it('accepts search alone (full-fetch mode)', () => {
    const result = FindAllPlaylistsQueryDto.schema.safeParse({
      search: 'благодать',
    });
    expect(result.success).toBe(true);
  });

  it('accepts page/limit and coerces them from strings to numbers', () => {
    const result = FindAllPlaylistsQueryDto.schema.safeParse({
      page: '2',
      limit: '20',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(2);
      expect(result.data.limit).toBe(20);
    }
  });

  it('accepts limit without page (page defaults to 1 in the service)', () => {
    const result = FindAllPlaylistsQueryDto.schema.safeParse({ limit: '20' });
    expect(result.success).toBe(true);
  });

  it('rejects a limit above the schema maximum', () => {
    const result = FindAllPlaylistsQueryDto.schema.safeParse({ limit: '101' });
    expect(result.success).toBe(false);
  });

  it('rejects a page below 1', () => {
    const result = FindAllPlaylistsQueryDto.schema.safeParse({ page: '0' });
    expect(result.success).toBe(false);
  });

  describe('sort/order direction defaults', () => {
    it('resolves sort to date and order to desc when both are absent', () => {
      const result = FindAllPlaylistsQueryDto.schema.safeParse({});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.sort).toBe('date');
        expect(result.data.order).toBe('desc');
      }
    });

    it('accepts sort/order and keeps the client values', () => {
      const result = FindAllPlaylistsQueryDto.schema.safeParse({
        sort: 'section',
        order: 'desc',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.sort).toBe('section');
        expect(result.data.order).toBe('desc');
      }
    });

    it('resolves the direction default directionally: asc for title', () => {
      const result = FindAllPlaylistsQueryDto.schema.safeParse({
        sort: 'title',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.sort).toBe('title');
        expect(result.data.order).toBe('asc');
      }
    });

    it('resolves asc for section', () => {
      const result = FindAllPlaylistsQueryDto.schema.safeParse({
        sort: 'section',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.sort).toBe('section');
        expect(result.data.order).toBe('asc');
      }
    });

    it('keeps date sort paired with the desc direction default', () => {
      const result = FindAllPlaylistsQueryDto.schema.safeParse({
        sort: 'date',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.sort).toBe('date');
        expect(result.data.order).toBe('desc');
      }
    });

    it('accepts search combined with sort (search wins in the service)', () => {
      const result = FindAllPlaylistsQueryDto.schema.safeParse({
        search: 'благодать',
        sort: 'title',
        order: 'asc',
      });
      expect(result.success).toBe(true);
    });

    it('rejects an unknown sort value', () => {
      const result = FindAllPlaylistsQueryDto.schema.safeParse({
        sort: 'relevance',
      });
      expect(result.success).toBe(false);
    });

    it('rejects an unknown order value', () => {
      const result = FindAllPlaylistsQueryDto.schema.safeParse({ order: 'up' });
      expect(result.success).toBe(false);
    });
  });
});
