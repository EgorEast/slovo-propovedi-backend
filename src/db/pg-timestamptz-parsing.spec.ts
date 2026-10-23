import { types } from 'pg';

// node-pg parses timestamptz (OID 1184) via pg-types' parseDate, which builds a
// JS Date — inherently millisecond precision. This spec pins down WHICH
// direction the sub-millisecond remainder takes, because the date sort/cursor
// design depends on it: the entity Date must equal
// date_trunc('milliseconds', stored_value), and a ROUNDING parser would make a
// cursor built from the entity Date disagree with the ORDER BY for values like
// .78905 (entity .790, sort key .789). FLOOR keeps them equal.
const parseTimestamptz = types.getTypeParser(1184, 'text') as (
  value: string,
) => Date;

describe('pg timestamptz (OID 1184) hydration', () => {
  it('round-trips an exact millisecond value unchanged', () => {
    expect(parseTimestamptz('2026-10-23 19:22:58.789+00').toISOString()).toBe(
      '2026-10-23T19:22:58.789Z',
    );
  });

  it('FLOORS a sub-millisecond remainder instead of rounding it', () => {
    // Remainder 50µs: rounding would yield .790 and break the equality between
    // the entity's Date and date_trunc('milliseconds', created_at).
    expect(parseTimestamptz('2026-10-23 19:22:58.78905+00').toISOString()).toBe(
      '2026-10-23T19:22:58.789Z',
    );
  });

  // If the floor assertion ever fails on a future pg version (i.e. pg starts
  // rounding), the keyset nextCursor must switch from the entity Date to a
  // raw-selected date_trunc('milliseconds', created_at)::text value — the same
  // rank-raw pattern used by sermon.service.ts in search mode. Do NOT implement
  // that fallback pre-emptively; only if this test goes red.
});
