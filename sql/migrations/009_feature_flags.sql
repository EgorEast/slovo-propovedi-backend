-- =============================================================================
-- Migration 009: feature_flag + feature_flag_override tables (2026-10-10)
-- =============================================================================
--
-- Adds remote feature toggles:
--   * feature_flag          — global default per feature key (`read`, `study`)
--   * feature_flag_override — per-user exceptions (`grant` / `deny`)
--
-- The effective value for a user is derived at read time (global default plus
-- the user's override; admins/moderators always see every flag on) — see
-- src/feature-flags/feature-flags.service.ts.
--
-- This migration is IDEMPOTENT — safe to run more than once:
--   * CREATE TABLE IF NOT EXISTS
--   * each constraint is added in a DO block guarded by pg_constraint by name
--     (Postgres has no `ADD CONSTRAINT IF NOT EXISTS`), so re-running on an
--     already-migrated database is a no-op
--   * the seed INSERT uses ON CONFLICT DO NOTHING
--
-- Fresh databases get the tables + constraints + seed directly from
-- sql/bootstrap.sql (same names), so running this migration there is a no-op.
--
-- Run as the DB owner, e.g.:
--   psql -h <host> -U <user> -d <db> -f sql/migrations/009_feature_flags.sql
--
-- REVERT (rollback on a broken deploy):
--   DROP TABLE IF EXISTS feature_flag_override;
--   DROP TABLE IF EXISTS feature_flag;
-- =============================================================================

-- 1. Tables
CREATE TABLE IF NOT EXISTS feature_flag (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    key character varying NOT NULL,
    title character varying NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS feature_flag_override (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    flag_id uuid NOT NULL,
    user_id uuid NOT NULL,
    -- "grant" | "deny"
    value character varying NOT NULL
);

-- 2. Primary keys
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'PK_feature_flag_id'
    ) THEN
        ALTER TABLE feature_flag
            ADD CONSTRAINT "PK_feature_flag_id" PRIMARY KEY (id);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'PK_feature_flag_override_id'
    ) THEN
        ALTER TABLE feature_flag_override
            ADD CONSTRAINT "PK_feature_flag_override_id" PRIMARY KEY (id);
    END IF;
END $$;

-- 3. Unique constraints
-- One row per feature key.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'UQ_feature_flag_key'
    ) THEN
        ALTER TABLE feature_flag
            ADD CONSTRAINT "UQ_feature_flag_key" UNIQUE (key);
    END IF;
END $$;

-- At most one override per (flag, user) pair.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'UQ_feature_flag_override_pair'
    ) THEN
        ALTER TABLE feature_flag_override
            ADD CONSTRAINT "UQ_feature_flag_override_pair" UNIQUE (flag_id, user_id);
    END IF;
END $$;

-- 4. Foreign keys (overrides die with their flag and with their user)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'FK_feature_flag_override_flag'
    ) THEN
        ALTER TABLE feature_flag_override
            ADD CONSTRAINT "FK_feature_flag_override_flag"
            FOREIGN KEY (flag_id) REFERENCES feature_flag(id) ON DELETE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'FK_feature_flag_override_user'
    ) THEN
        ALTER TABLE feature_flag_override
            ADD CONSTRAINT "FK_feature_flag_override_user"
            FOREIGN KEY (user_id) REFERENCES "user"(id) ON DELETE CASCADE;
    END IF;
END $$;

-- 5. Seed the features the mobile app already gates on (disabled by default).
INSERT INTO feature_flag (key, title, enabled)
VALUES
    ('read', 'Читать', false),
    ('study', 'Учиться', false)
ON CONFLICT (key) DO NOTHING;
