import { FindOrphansQueryDto } from './find-orphans-query.dto';

describe('FindOrphansQueryDto', () => {
  it('defaults limit to 500 when absent', () => {
    const result = FindOrphansQueryDto.schema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(500);
    }
  });

  it('coerces limit from string to number', () => {
    const result = FindOrphansQueryDto.schema.safeParse({ limit: '25' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(25);
    }
  });

  it('accepts the maximum limit', () => {
    const result = FindOrphansQueryDto.schema.safeParse({ limit: '5000' });
    expect(result.success).toBe(true);
  });

  it('rejects a limit above the schema maximum', () => {
    const result = FindOrphansQueryDto.schema.safeParse({ limit: '5001' });
    expect(result.success).toBe(false);
  });

  it('rejects a limit below 1', () => {
    const result = FindOrphansQueryDto.schema.safeParse({ limit: '0' });
    expect(result.success).toBe(false);
  });

  it('rejects unknown keys at the boundary', () => {
    const result = FindOrphansQueryDto.schema.safeParse({ offset: '10' });
    expect(result.success).toBe(false);
  });
});
