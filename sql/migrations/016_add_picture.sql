-- =============================================================================
-- Migration 016: picture table for cover blurhash (2026-11-07)
-- =============================================================================
--
-- Adds the `picture` table: one row per uploaded image object, holding the
-- BlurHash placeholder the client shows while the original cover loads. Rows
-- are written on upload (AppController -> PicturesService.recordForUpload) and
-- backfilled by scripts/backfill-blurhash.mjs.
--
-- `picture-path` stores the MinIO object name (e.g. `uuid.jpg`) and is UNIQUE:
-- the service's upsert semantics rely on at most one row per object name.
--
-- This migration is IDEMPOTENT — safe to run more than once:
--   * CREATE TABLE IF NOT EXISTS
--     (constraints are declared inline, so an already-created table is left
--     untouched by a re-run)
--
-- Fresh databases get the table directly from sql/bootstrap.sql (same
-- structure), so running this migration there is a no-op.
--
-- Run as the DB owner, e.g.:
--   psql -h <host> -U <user> -d <db> -f sql/migrations/016_add_picture.sql
--
-- REVERT (rollback on a broken deploy):
--   DROP TABLE IF EXISTS picture;
-- =============================================================================

CREATE TABLE IF NOT EXISTS picture (
    id uuid DEFAULT uuidv7() NOT NULL,
    "picture-path" character varying NOT NULL,
    blurhash character varying,
    CONSTRAINT "PK_picture_id" PRIMARY KEY (id),
    CONSTRAINT "UQ_picture_picture_path" UNIQUE ("picture-path")
);
