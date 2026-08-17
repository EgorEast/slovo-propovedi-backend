-- =============================================================================
-- Migration 007: sermon.chapter integer → json (chapter range support) (2026-08-17)
-- =============================================================================
--
-- The API contract (OpenAPI 0.12.0) allows a sermon scripture reference to
-- carry a chapter RANGE: `chapter` is now `integer | [integer, integer] | null`
-- (mirroring the existing `verse` union). A chapter range is needed for
-- references that cross chapters, e.g. «1е Коринфянам 10:23–11:1» →
-- chapter [10, 11], verse [23, 1].
--
-- The column type changes from `integer` to `json` so a single value stays a
-- JSON number (`3`) and a range becomes a JSON array (`[10, 11]`). The entity
-- (`src/sermon/entities/sermon.entity.ts`) declares `type: 'json'` — the same
-- storage as the adjacent `verse` column.
--
-- Conversion: `to_json(chapter)` wraps the existing integer into a JSON number
-- (NOT `to_jsonb` — the entity reads `json`, and NOT `json_build_array` — that
-- would corrupt a single value `3` into `[3]`).
--
-- This migration is IDEMPOTENT — safe to run more than once:
--   * the ALTER runs only when the column is still `integer` (guarded by
--     information_schema), so re-running on an already-migrated database is a
--     no-op
--
-- Fresh databases get the `json` column directly from sql/bootstrap.sql, so
-- running this migration there is a no-op too.
--
-- Run as the DB owner, e.g.:
--   psql -h <host> -U <user> -d <db> -f sql/migrations/007_chapter_range.sql
--
-- REVERT (rollback on a broken deploy):
--   ALTER TABLE sermon ALTER COLUMN chapter TYPE integer USING (chapter::text)::integer;
--   (fails loudly on any row whose chapter is a JSON array — a range cannot be
--   stored back in an integer column; such rows must be edited first)
-- =============================================================================

-- 1. Widen the column only while it is still integer (idempotent re-run)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'sermon'
          AND column_name = 'chapter'
          AND data_type = 'integer'
          AND table_schema = current_schema()
    ) THEN
        ALTER TABLE sermon ALTER COLUMN chapter TYPE json USING to_json(chapter);
    END IF;
END $$;