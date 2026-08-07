-- =============================================================================
-- Migration 001: add position columns for drag-and-drop reordering (2026-08-07)
-- =============================================================================
--
-- Existing databases were provisioned before the drag-and-drop reordering
-- feature, so their tables lack the `position` columns. Fresh databases get
-- them from sql/bootstrap.sql (which matches TypeORM `synchronize` output).
--
-- This migration is IDEMPOTENT — safe to run more than once:
--   * ADD COLUMN IF NOT EXISTS for each position column
--   * each backfill UPDATE is guarded with WHERE position = 0, so it only
--     assigns positions to rows still holding the placeholder default — rows
--     whose position was already persisted by the app (via the reorder
--     endpoints) are left untouched
--   * CREATE INDEX IF NOT EXISTS
--
-- The position columns are NOT NULL with DEFAULT 0, so after this migration an
-- invalid (missing position) state is impossible — every row has a concrete,
-- valid order value. The backfill then replaces the placeholder zeros with a
-- deterministic initial order based on insertion order (approximated by uuid
-- ordering, since the tables have no created_at / serial column). Clients later
-- persist explicit orders via the reorder endpoints; the WHERE position = 0
-- guard keeps those persisted orders intact on every re-run.
--
-- Run as the DB owner, e.g.:
--   psql -h <host> -U <user> -d <db> -f backend/sql/migrations/001_add_positions.sql
-- =============================================================================

-- 1. section.position — global order of sections
ALTER TABLE section ADD COLUMN IF NOT EXISTS "position" integer NOT NULL DEFAULT 0;

-- 2. playlist_sermons_sermon.position — order of sermons within a playlist
ALTER TABLE playlist_sermons_sermon ADD COLUMN IF NOT EXISTS "position" integer NOT NULL DEFAULT 0;

-- 3. section_playlists_playlist.position — order of playlists within a section
ALTER TABLE section_playlists_playlist ADD COLUMN IF NOT EXISTS "position" integer NOT NULL DEFAULT 0;

-- 4. Join tables gain a surrogate id primary key
--
-- Phase 5 refactored the many-to-many relations from @ManyToMany/@JoinTable to
-- explicit join entities (PlaylistSermonJoinEntity / SectionPlaylistJoinEntity)
-- that carry their own `id` column. Existing databases were created with the
-- composite ("playlistId", "sermonId") / ("sectionId", "playlistId") primary
-- keys, so each table is migrated as:
--   1. drop the composite PK
--   2. add the surrogate id column (uuid, generated)
--   3. promote id to the new PK
--   4. restore the FK-pair uniqueness as a UNIQUE constraint
--
-- The DO blocks are idempotent: they run only when the `id` column is absent,
-- so re-running this migration on an already-migrated database is a no-op.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'playlist_sermons_sermon' AND column_name = 'id'
    ) THEN
        ALTER TABLE playlist_sermons_sermon DROP CONSTRAINT IF EXISTS "PK_8eae5095c69292abbe514b959ce";
        ALTER TABLE playlist_sermons_sermon ADD COLUMN id uuid DEFAULT public.uuid_generate_v4();
        ALTER TABLE playlist_sermons_sermon ALTER COLUMN id SET NOT NULL;
        ALTER TABLE playlist_sermons_sermon ADD CONSTRAINT "PK_playlist_sermons_sermon_id" PRIMARY KEY (id);
        ALTER TABLE playlist_sermons_sermon ADD CONSTRAINT "UQ_playlist_sermons_sermon_pair" UNIQUE ("playlistId", "sermonId");
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'section_playlists_playlist' AND column_name = 'id'
    ) THEN
        ALTER TABLE section_playlists_playlist DROP CONSTRAINT IF EXISTS "PK_5d0453111a321630eac68ada913";
        ALTER TABLE section_playlists_playlist ADD COLUMN id uuid DEFAULT public.uuid_generate_v4();
        ALTER TABLE section_playlists_playlist ALTER COLUMN id SET NOT NULL;
        ALTER TABLE section_playlists_playlist ADD CONSTRAINT "PK_section_playlists_playlist_id" PRIMARY KEY (id);
        ALTER TABLE section_playlists_playlist ADD CONSTRAINT "UQ_section_playlists_playlist_pair" UNIQUE ("sectionId", "playlistId");
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Backfill positions (ROW_NUMBER() - 1 => zero-based ordering)
-- ---------------------------------------------------------------------------

-- section.position: global sequence across all sections, ordered by insertion
-- order (approximated by id ordering — no created_at column exists). Only rows
-- still at the placeholder default (position = 0) are backfilled; positions
-- already persisted by the reorder endpoint survive re-runs untouched.
WITH ranked AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY id) - 1 AS new_pos
    FROM section
    WHERE position = 0
)
UPDATE section
SET position = ranked.new_pos
FROM ranked
WHERE section.id = ranked.id;

-- playlist_sermons_sermon.position: per-playlist sermon order, partitioned by
-- playlist and ordered by sermon insertion order (approximated by "sermonId").
-- Only rows still at the placeholder default are backfilled.
WITH ranked AS (
    SELECT "playlistId", "sermonId",
           ROW_NUMBER() OVER (PARTITION BY "playlistId" ORDER BY "sermonId") - 1 AS new_pos
    FROM playlist_sermons_sermon
    WHERE position = 0
)
UPDATE playlist_sermons_sermon
SET position = ranked.new_pos
FROM ranked
WHERE playlist_sermons_sermon."playlistId" = ranked."playlistId"
  AND playlist_sermons_sermon."sermonId" = ranked."sermonId";

-- section_playlists_playlist.position: per-section playlist order, partitioned
-- by section and ordered by playlist insertion order (approximated by "playlistId").
-- Only rows still at the placeholder default are backfilled.
WITH ranked AS (
    SELECT "sectionId", "playlistId",
           ROW_NUMBER() OVER (PARTITION BY "sectionId" ORDER BY "playlistId") - 1 AS new_pos
    FROM section_playlists_playlist
    WHERE position = 0
)
UPDATE section_playlists_playlist
SET position = ranked.new_pos
FROM ranked
WHERE section_playlists_playlist."sectionId" = ranked."sectionId"
  AND section_playlists_playlist."playlistId" = ranked."playlistId";

-- ---------------------------------------------------------------------------
-- Indexes for efficient ordering queries
-- ---------------------------------------------------------------------------

-- Global section ordering is queried by the reorder + list endpoints.
CREATE INDEX IF NOT EXISTS idx_section_position ON section (position);

-- Join-table position indexes are intentionally omitted: the UNIQUE
-- ("playlistId", "sermonId") / ("sectionId", "playlistId") constraints
-- (added above / present since bootstrap) already provide efficient access
-- patterns for per-parent ordering queries.
