-- =============================================================================
-- Migration 008: invidious_instance table (2026-10-06)
-- =============================================================================
--
-- Adds the storage for the admin-managed list of Invidious instances offered
-- as presets by the mobile sermon-import form. The list is fully replaced by
-- `PUT /invidious-instances`; the backend seeds two verified instances when the
-- table is empty (see src/invidious-instances/invidious-instances.service.ts).
--
-- This migration is IDEMPOTENT — safe to run more than once:
--   * CREATE TABLE IF NOT EXISTS
--   * each constraint (PK / UNIQUE url) is added in a DO block guarded by
--     pg_constraint by name (Postgres has no `ADD CONSTRAINT IF NOT EXISTS`),
--     so re-running on an already-migrated database is a no-op
--
-- Fresh databases get the table + constraints directly from sql/bootstrap.sql
-- (same constraint names), so running this migration there is a no-op too.
--
-- Run as the DB owner, e.g.:
--   psql -h <host> -U <user> -d <db> -f sql/migrations/008_add_invidious_instances.sql
--
-- REVERT (rollback on a broken deploy):
--   DROP TABLE IF EXISTS invidious_instance;
-- =============================================================================

-- 1. Table: one row per Invidious instance (serial id doubles as display order)
CREATE TABLE IF NOT EXISTS invidious_instance (
    id serial NOT NULL,
    url character varying NOT NULL
);

-- 2. Primary key
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'PK_invidious_instance_id'
    ) THEN
        ALTER TABLE invidious_instance
            ADD CONSTRAINT "PK_invidious_instance_id" PRIMARY KEY (id);
    END IF;
END $$;

-- 3. Unique URL constraint (duplicate instances are meaningless)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'UQ_invidious_instance_url'
    ) THEN
        ALTER TABLE invidious_instance
            ADD CONSTRAINT "UQ_invidious_instance_url" UNIQUE (url);
    END IF;
END $$;
