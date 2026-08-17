-- =============================================================================
-- Migration 005: sermon full-text search (tsvector + GIN index) (2026-08-14)
-- =============================================================================
--
-- Word-order-independent, relevance-ranked sermon search (`GET /sermons`):
-- the searchable fields are folded into ONE generated `tsvector` column with
-- per-field weights, and the service matches a `tsquery` against it with
-- `ts_rank` ordering (see docs/modules/sermon.md).
--
-- Weights (setweight):
--   'A' title       — ranks highest
--   'B' artist, book — mid
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
--   psql -h <host> -U <user> -d <db> -f sql/migrations/005_sermon_search_tsvector.sql
-- =============================================================================

-- 1. Generated tsvector column (kept in sync on every INSERT/UPDATE)
ALTER TABLE sermon
    ADD COLUMN IF NOT EXISTS search_vector tsvector
    GENERATED ALWAYS AS (
        setweight(to_tsvector('russian', coalesce(title, '')), 'A')
        || setweight(to_tsvector('russian', coalesce(artist, '')), 'B')
        || setweight(to_tsvector('russian', coalesce(book, '')), 'B')
        || setweight(to_tsvector('russian', coalesce(description, '')), 'D')
    ) STORED;

-- 2. GIN index backing the `search_vector @@ tsquery` lookups
CREATE INDEX IF NOT EXISTS "IDX_sermon_search_vector"
    ON sermon USING GIN (search_vector);
