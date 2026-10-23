-- =============================================================================
-- Migration 014: native uuidv7() primary-key defaults (2026-10-23)
-- =============================================================================
--
-- Switches every uuid primary key from uuid_generate_v4() (uuid-ossp) to the
-- native PostgreSQL uuidv7(). UUIDv7 is time-ordered, so new rows append to
-- the btree index instead of scattering across it (index locality) and the
-- id tiebreaker in date-ordered pages matches insertion order.
--
-- PostgreSQL >= 18 is REQUIRED: uuidv7() was added in PostgreSQL 18. The
-- precheck below fails fast with a clear message on an older cluster — it does
-- not attempt a fallback, because a v4 default would silently reintroduce the
-- unordered ids this migration exists to remove.
--
-- Idempotent: ALTER COLUMN ... SET DEFAULT only touches the catalog (no table
-- rewrite), so re-running the file is safe.
--
-- The application entities keep @PrimaryGeneratedColumn('uuid') — TypeORM
-- emits a literal DEFAULT for generated uuid columns, so ids stay DB-side; no
-- application code generates them.
--
-- Run as the DB owner, e.g.:
--   psql -h <host> -U <user> -d <db> -f sql/migrations/014_uuid_v7_defaults.sql
--
-- REVERT (rollback on a broken deploy; requires the uuid-ossp extension):
--   ALTER TABLE "user" ALTER COLUMN id SET DEFAULT public.uuid_generate_v4();
--   ALTER TABLE revoked_refresh_token ALTER COLUMN id SET DEFAULT public.uuid_generate_v4();
--   ALTER TABLE feature_flag ALTER COLUMN id SET DEFAULT public.uuid_generate_v4();
--   ALTER TABLE feature_flag_override ALTER COLUMN id SET DEFAULT public.uuid_generate_v4();
--   ALTER TABLE sermon ALTER COLUMN id SET DEFAULT public.uuid_generate_v4();
--   ALTER TABLE playlist ALTER COLUMN id SET DEFAULT public.uuid_generate_v4();
--   ALTER TABLE playlist_sermons_sermon ALTER COLUMN id SET DEFAULT public.uuid_generate_v4();
--   ALTER TABLE section_playlists_playlist ALTER COLUMN id SET DEFAULT public.uuid_generate_v4();
--   ALTER TABLE section ALTER COLUMN id SET DEFAULT public.uuid_generate_v4();
-- =============================================================================

-- 0. Precheck — fail loud on PostgreSQL < 18 instead of creating v4 defaults.
--    uuidv7() is a pg_catalog built-in with two overloads, so resolve the exact
--    zero-argument signature with to_regprocedure (to_regproc is ambiguous and
--    a public-qualified lookup never finds a built-in).
DO $$ BEGIN
  IF to_regprocedure('uuidv7()') IS NULL THEN
    RAISE EXCEPTION 'uuidv7() is not available — PostgreSQL 18+ is required. Upgrade the cluster first, then re-run 014_uuid_v7_defaults.sql.';
  END IF;
END $$;

-- 1. Switch every uuid PK default to uuidv7(). "user" is a reserved word and
--    must stay quoted; the join-table names match sql/migrations/001 and
--    sql/bootstrap.sql. The function is unqualified because it lives in
--    pg_catalog (always implicitly searched), not in public.
ALTER TABLE "user" ALTER COLUMN id SET DEFAULT uuidv7();
ALTER TABLE revoked_refresh_token ALTER COLUMN id SET DEFAULT uuidv7();
ALTER TABLE feature_flag ALTER COLUMN id SET DEFAULT uuidv7();
ALTER TABLE feature_flag_override ALTER COLUMN id SET DEFAULT uuidv7();
ALTER TABLE sermon ALTER COLUMN id SET DEFAULT uuidv7();
ALTER TABLE playlist ALTER COLUMN id SET DEFAULT uuidv7();
ALTER TABLE playlist_sermons_sermon ALTER COLUMN id SET DEFAULT uuidv7();
ALTER TABLE section_playlists_playlist ALTER COLUMN id SET DEFAULT uuidv7();
ALTER TABLE section ALTER COLUMN id SET DEFAULT uuidv7();

-- 2. OPTIONAL, SAFE TO SKIP: uuid-ossp becomes unreferenced once the defaults
--    above are in place (those were the only users of uuid_generate_v4()). It
--    is dropped explicitly here to keep the extension list honest; comment the
--    statement out if any other database/user still depends on it.
--    DROP EXTENSION IF EXISTS "uuid-ossp";
