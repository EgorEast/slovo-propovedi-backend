-- =============================================================================
-- Migration 013a: sermon.created_at + playlist.created_at (2026-10-23)
-- =============================================================================
--
-- Adds the created_at column to sermon and playlist. It backs the published
-- SermonEntity.createdAt / PlaylistEntity.createdAt contract and the new
-- sort=date semantics («по дате добавления (created_at), при равенстве — по
-- id»): both the keyset cursor and the ORDER BY read this column.
--
-- The column type/default matches feature_flag.created_at, feature_flag_
-- override.created_at and the entities' @CreateDateColumn (timestamptz +
-- now() NOT NULL).
--
-- BACKFILL: ADD COLUMN ... DEFAULT now() NOT NULL is METADATA-ONLY on
-- PostgreSQL 11+ — no table rewrite, and every existing row receives the SAME
-- atomic placeholder timestamp (the moment this statement runs). That
-- placeholder IS the backfill seed: real per-row dates are then recovered from
-- the object mtimes in MinIO by scripts/backfill-created-at.mjs (dry-run by
-- default). This file deliberately does NOT try to be cleverer: statements
-- stay single and portable, so the migration works on any PostgreSQL version.
--
-- This migration is IDEMPOTENT — safe to run more than once:
--   * ADD COLUMN IF NOT EXISTS
--
-- Fresh databases get the columns directly from sql/bootstrap.sql, so running
-- this migration there is a no-op.
--
-- Run as the DB owner, e.g.:
--   psql -h <host> -U <user> -d <db> -f sql/migrations/013a_add_created_at.sql
--
-- REVERT (rollback on a broken deploy):
--   ALTER TABLE sermon DROP COLUMN IF EXISTS created_at;
--   ALTER TABLE playlist DROP COLUMN IF EXISTS created_at;
-- =============================================================================

ALTER TABLE sermon
    ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE playlist
    ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
