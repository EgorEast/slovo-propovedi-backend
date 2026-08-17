import { FindAllUsersQueryDto } from './find-all-users-query.dto';

describe('FindAllUsersQueryDto (offset pagination)', () => {
  it('accepts an empty query (full-fetch mode)', () => {
    const result = FindAllUsersQueryDto.schema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('accepts page/limit and coerces them from strings to numbers', () => {
    const result = FindAllUsersQueryDto.schema.safeParse({
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
    const result = FindAllUsersQueryDto.schema.safeParse({ limit: '20' });
    expect(result.success).toBe(true);
  });

  it('rejects a limit above the schema maximum', () => {
    const result = FindAllUsersQueryDto.schema.safeParse({ limit: '101' });
    expect(result.success).toBe(false);
  });

  it('rejects a page below 1', () => {
    const result = FindAllUsersQueryDto.schema.safeParse({ page: '0' });
    expect(result.success).toBe(false);
  });
});
