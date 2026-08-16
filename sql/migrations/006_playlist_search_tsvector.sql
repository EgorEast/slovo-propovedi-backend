-- =============================================================================
-- Migration 006: playlist full-text search (tsvector + GIN index) (2026-08-16)
-- =============================================================================
--
-- Word-order-independent, relevance-ranked playlist search (`GET /playlists?search=`):
-- the searchable fields are folded into ONE generated `tsvector` column with
-- per-field weights, and the service matches a `tsquery` against it with
-- `ts_rank` ordering (see docs/modules/playlist.md).
--
-- Weights (setweight):
--   'A' title        — ranks highest
--   'D' description  — ranks lowest
--
-- The explicit regconfig argument `to_tsvector('russian', ...)` makes the
-- expression IMMUTABLE (the config is a constant, not a column reference),
-- which PostgreSQL requires for a STORED GENERATED column.
--
-- REQUIREMENTS:
--   * PostgreSQL >= 12 (generated columns are a PG 12 feature).
--   * The `russian` text-search configuration must exist (it is built in).
--
-- This migration is IDEMPOTENT — safe to run more than once:
--   * ADD COLUMN IF NOT EXISTS (re-running is a no-op)
--   * CREATE INDEX IF NOT EXISTS (re-running is a no-op)
--
-- Fresh databases get the same column + index directly from
-- sql/bootstrap.sql, so running this migration there is a no-op too.
--
-- Run as the DB owner, e.g.:
--   psql -h <host> -U <user> -d <db> -f backend/sql/migrations/006_playlist_search_tsvector.sql
-- =============================================================================

-- 1. Generated tsvector column (kept in sync on every INSERT/UPDATE)
ALTER TABLE playlist
    ADD COLUMN IF NOT EXISTS search_vector tsvector
    GENERATED ALWAYS AS (
        setweight(to_tsvector('russian', coalesce(title, '')), 'A')
        || setweight(to_tsvector('russian', coalesce(description, '')), 'D')
    ) STORED;

-- 2. GIN index backing the `search_vector @@ tsquery` lookups
CREATE INDEX IF NOT EXISTS "IDX_playlist_search_vector"
    ON playlist USING GIN (search_vector);
