-- =============================================================================
-- One-off migration: add username column for login-by-username (2026-08-06)
-- =============================================================================
--
-- Existing production databases were provisioned before the login-by-username
-- change, so they lack the `username` column on "user". Fresh databases get it
-- from sql/bootstrap.sql (which matches TypeORM `synchronize` output exactly).
--
-- This migration is IDEMPOTENT — safe to run more than once:
--   * ADD COLUMN IF NOT EXISTS
--   * backfill only fills rows that still have NULL
--   * DROP CONSTRAINT IF EXISTS before re-creating the unique constraint
--
-- The constraint name UQ_78a916df40e02a9deb1c4b75edb is the exact name
-- TypeORM `synchronize` generates for the `username` column on table "user"
-- (UQ_ + sha1("user_username") truncated to 27 chars, per DefaultNamingStrategy)
-- and matches the one declared in sql/bootstrap.sql.
--
-- Backfill value `admin` MUST match the playbook var
-- `slovo_admin_user_username: admin`.
-- This migration assumes exactly one admin row — the playbook
-- slovo-admin-user seeds exactly one.
--
-- Run as the DB owner, e.g.:
--   psql -h <host> -U <user> -d <db> -f backend/sql/migrate-add-username.sql
-- =============================================================================

ALTER TABLE "user" ADD COLUMN IF NOT EXISTS username character varying;

-- Guard: this migration assumes a single admin row (playbook slovo-admin-user seeds exactly one).
-- If more than one row lacks a username, abort loudly instead of creating duplicate 'admin' values
-- that would make the subsequent ADD CONSTRAINT UNIQUE fail.
DO $$
BEGIN
    IF (SELECT count(*) FROM "user" WHERE username IS NULL) > 1 THEN
        RAISE EXCEPTION 'Multiple rows in "user" have NULL username. Resolve (backfill manually) before re-running this migration.';
    END IF;
END $$;

UPDATE "user" SET username = 'admin' WHERE username IS NULL;

ALTER TABLE "user" ALTER COLUMN username SET NOT NULL;

ALTER TABLE "user" DROP CONSTRAINT IF EXISTS "UQ_78a916df40e02a9deb1c4b75edb";
ALTER TABLE "user" ADD CONSTRAINT "UQ_78a916df40e02a9deb1c4b75edb" UNIQUE (username);
