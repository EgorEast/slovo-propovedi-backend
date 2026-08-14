-- =============================================================================
-- Migration 002: three-tier roles (admin / moderator / user) (2026-08-14)
-- =============================================================================
--
-- The OpenAPI spec (v0.6.0) introduces `role` (enum admin/moderator/user) on
-- the user resource: REQUIRED in every user response, OPTIONAL on create/update
-- (missing → default 'user'). Existing databases were provisioned before roles,
-- when EVERY account was an implicit admin, so this migration:
--
--   1. adds the `role` column (nullable first — old rows have no value)
--   2. backfills every NULL to 'admin' — preserves the current implicit-admin
--      behaviour: everyone who already has an account keeps admin privileges
--   3. sets the column DEFAULT to 'user' — least privilege for all FUTURE
--      inserts (the app also sets `role` explicitly on create)
--   4. SET NOT NULL — after the backfill no NULL can ever exist
--   5. adds a CHECK (role IN ('admin','moderator','user')) so an invalid role
--      value is impossible at the DB layer, not just at the API boundary
--
-- This migration is IDEMPOTENT — safe to run more than once:
--   * ADD COLUMN IF NOT EXISTS
--   * the backfill UPDATE only touches rows where role IS NULL
--   * SET DEFAULT / SET NOT NULL on an already-configured column are no-ops
--   * the CHECK is added only when a constraint named `user_role_check` does
--     not already exist (the same name is declared in sql/bootstrap.sql, so
--     re-running this migration on a fresh bootstrap database is a no-op)
--
-- Fresh databases get the column + CHECK directly from sql/bootstrap.sql.
--
-- Run as the DB owner, e.g.:
--   psql -h <host> -U <user> -d <db> -f backend/sql/migrations/002_add_user_roles.sql
-- =============================================================================

-- 1. Add the column (nullable for the backfill step)
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS role varchar;

-- 2. Backfill: every existing account was implicitly an admin — preserve that.
UPDATE "user" SET role = 'admin' WHERE role IS NULL;

-- 3. Least privilege for future inserts (create defaults to 'user').
ALTER TABLE "user" ALTER COLUMN role SET DEFAULT 'user';

-- 4. After the backfill a NULL role is impossible — enforce it.
ALTER TABLE "user" ALTER COLUMN role SET NOT NULL;

-- 5. CHECK constraint (idempotent): an invalid role is unrepresentable.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_role_check') THEN
        ALTER TABLE "user" ADD CONSTRAINT user_role_check CHECK (role IN ('admin', 'moderator', 'user'));
    END IF;
END $$;
