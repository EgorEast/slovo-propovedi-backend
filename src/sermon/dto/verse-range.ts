// A verse range is exactly two integers — the only verse shape that can be
// anchored to a chapter range. A single integer or a segments array
// ([[9,18],20]) cannot be anchored to a chapter range.
export const isVerseRange = (verse: unknown): verse is [number, number] =>
  Array.isArray(verse) &&
  verse.length === 2 &&
  verse.every((value) => typeof value === 'number');

// Shared by the DTO superRefine rules and the service's cross-request guard:
// the service must reject the same combination the DTOs declare impossible.
export const CHAPTER_RANGE_VERSE_MESSAGE =
  'verse must be a two-integer range or null when chapter is a range';
