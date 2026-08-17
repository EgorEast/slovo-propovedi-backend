-- =============================================================================
-- Migration 003: revoked refresh tokens (logout denylist) (2026-08-14)
-- =============================================================================
--
-- `POST /auth/logout` revokes the presented refresh token by storing the
-- sha256 hash of the token in `revoked_refresh_token`; `POST /auth/refresh`
-- rejects any token whose hash is present (denylist). The denylist row lives
-- until the token's own `exp` — afterwards the token is expired anyway, so the
-- row is garbage and is purged opportunistically on every logout.
--
-- The access token is NOT in the denylist: it stays technically valid until
-- its own expiry (≤ 30 minutes). The client must discard both tokens on
-- logout.
--
-- This migration is IDEMPOTENT — safe to run more than once:
--   * CREATE TABLE IF NOT EXISTS
--   * each constraint (PK / UNIQUE token_hash / FK user_id -> "user"(id)) is
--     added in a DO block guarded by pg_constraint by name (Postgres has no
--     `ADD CONSTRAINT IF NOT EXISTS`), so re-running on an already-migrated
--     database is a no-op
--
-- Fresh databases get the table + constraints directly from sql/bootstrap.sql
-- (same constraint names), so running this migration there is a no-op too.
--
-- Run as the DB owner, e.g.:
--   psql -h <host> -U <user> -d <db> -f sql/migrations/003_revoked_refresh_tokens.sql
-- =============================================================================

-- 1. Table: one row per revoked refresh token (keyed by token hash)
CREATE TABLE IF NOT EXISTS revoked_refresh_token (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    token_hash character varying NOT NULL,
    user_id uuid NOT NULL,
    revoked_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL
);

-- 2. Primary key
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PK_revoked_refresh_token') THEN
        ALTER TABLE ONLY revoked_refresh_token
            ADD CONSTRAINT "PK_revoked_refresh_token" PRIMARY KEY (id);
    END IF;
END $$;

-- 3. UNIQUE token_hash — the denylist lookup key, and the guard that makes a
--    double logout (same token twice) a no-op via INSERT ... ON CONFLICT DO NOTHING
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'UQ_revoked_refresh_token_token_hash') THEN
        ALTER TABLE ONLY revoked_refresh_token
            ADD CONSTRAINT "UQ_revoked_refresh_token_token_hash" UNIQUE (token_hash);
    END IF;
END $$;

-- 4. FK user_id -> "user"(id) ON DELETE CASCADE — deleting an account drops its
--    denylist rows
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_revoked_refresh_token_user') THEN
        ALTER TABLE ONLY revoked_refresh_token
            ADD CONSTRAINT "FK_revoked_refresh_token_user"
            FOREIGN KEY (user_id) REFERENCES "user"(id) ON DELETE CASCADE;
    END IF;
END $$;
