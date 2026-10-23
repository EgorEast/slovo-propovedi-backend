-- =============================================================================
-- Migration 015: rekey existing uuid primary keys to uuidv7 (2026-10-23)
-- =============================================================================
--
-- Replaces EVERY existing uuid primary key with a fresh uuidv7 value and
-- cascades the new ids into every referencing foreign-key column. Rows created
-- after migration 014 already default to uuidv7(); this migration exists only
-- to give the pre-014 rows time-ordered ids too — new rows then append to the
-- btree index instead of scattering across it, and the id tiebreaker in
-- sort=date matches insertion order (same rationale as 014).
--
-- ATOMIC: the whole migration runs in one transaction (BEGIN ... COMMIT).
-- Either every row moves to a v7 id or — on any error — nothing changes.
--
-- NO IN-PLACE REVERT: the swap discards the old ids by design and the old →
-- new mapping is not kept, so there is no SQL rollback once COMMIT succeeds.
-- The only recovery is restoring the pre-migration backup. TAKE A VERIFIED
-- pg_dump (or volume snapshot) IMMEDIATELY BEFORE running this file and
-- confirm it restores before you need it.
--
-- ACCEPTED BREAKS (product-approved, ~20 accounts):
--   * every existing user is logged out — access/refresh JWTs carry the old
--     user id, which no longer exists, so users must log in again;
--   * client caches and saved deep-links holding an old id stop resolving
--     until the client re-fetches after re-login.
--
-- ORDERING INVARIANT: a child's FK constraint is dropped BEFORE its parent's
-- ids are swapped (so no FK ever references a half-renamed parent), children
-- are remapped while the parent still holds the old ids, then the parent ids
-- are swapped and the FK constraint is re-added (validating the new pairs).
-- UNIQUE constraints on FK pairs (join-table pairs, feature_flag_override's
-- (flag_id, user_id)) are never dropped: the old → new mapping is 1:1, so pair
-- uniqueness is preserved.
--
-- IDEMPOTENT per table: each block returns early when no v4 primary keys
-- remain (version nibble '4' at position 15 of the uuid text form), so
-- re-running a completed migration is a clean no-op. Id DEFAULTs already point
-- at uuidv7() after 014 and are left untouched.
--
-- PostgreSQL >= 18 is REQUIRED: uuidv7() is a pg_catalog built-in added in 18,
-- so resolve the exact zero-argument signature with to_regprocedure (the same
-- fail-fast precheck as 014). No fallback — a v4 default would reintroduce the
-- unordered ids this rekey exists to remove.
--
-- RUNBOOK ORDER: 013 → 014 → 015 → scripts/backfill-created-at.mjs → deploy.
-- 015 rewrites ids only and never touches created_at, so the backfill may run
-- before or after it; keep 014 before 015 so the id DEFAULT is already
-- uuidv7() for rows inserted after the rekey. Run this file while the
-- application is stopped: it takes ACCESS EXCLUSIVE locks on every table and
-- rewrites every row.
--
-- Run as the DB owner, e.g.:
--   psql -h <host> -U <user> -d <db> -f sql/migrations/015_rekey_uuid_v7.sql
--
-- REVERT (rollback on a broken deploy): none in place — restore the
-- pre-rekey backup taken per the precondition above, then re-apply 013/014 in
-- the runbook order. Rows written after 015 are lost by that restore; that is
-- the accepted cost of the rekey.
-- =============================================================================

-- 0. Precheck — fail loud on PostgreSQL < 18, exactly like 014. uuidv7() is a
--    pg_catalog built-in with two overloads, so to_regprocedure() pins the
--    zero-argument signature (to_regproc is ambiguous, and a public-qualified
--    lookup never finds a built-in).
DO $$ BEGIN
  IF to_regprocedure('uuidv7()') IS NULL THEN
    RAISE EXCEPTION 'uuidv7() is not available — PostgreSQL 18+ is required. Upgrade the cluster first, then re-run 015_rekey_uuid_v7.sql.';
  END IF;
END $$;

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. "user" — referenced by revoked_refresh_token.user_id and
--    feature_flag_override.user_id.
-- -----------------------------------------------------------------------------
DO $rekey_user$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "user" WHERE substring(id::text, 15, 1) = '4') THEN
    RAISE NOTICE 'rekey 015: "user" has no v4 ids left — skipped';
    RETURN;
  END IF;

  ALTER TABLE revoked_refresh_token DROP CONSTRAINT IF EXISTS "FK_revoked_refresh_token_user";
  ALTER TABLE feature_flag_override DROP CONSTRAINT IF EXISTS "FK_feature_flag_override_user";
  ALTER TABLE "user" DROP CONSTRAINT IF EXISTS "PK_cace4a159ff9f2512dd42373760";

  ALTER TABLE "user" ADD COLUMN rekey_new_id uuid;
  UPDATE "user" SET rekey_new_id = uuidv7();

  UPDATE revoked_refresh_token c
     SET user_id = p.rekey_new_id
    FROM "user" p
   WHERE c.user_id = p.id;
  UPDATE feature_flag_override c
     SET user_id = p.rekey_new_id
    FROM "user" p
   WHERE c.user_id = p.id;

  UPDATE "user" SET id = rekey_new_id;
  ALTER TABLE "user" DROP COLUMN rekey_new_id;

  ALTER TABLE "user"
      ADD CONSTRAINT "PK_cace4a159ff9f2512dd42373760" PRIMARY KEY (id);
  ALTER TABLE revoked_refresh_token
      ADD CONSTRAINT "FK_revoked_refresh_token_user" FOREIGN KEY (user_id) REFERENCES "user"(id) ON DELETE CASCADE;
  ALTER TABLE feature_flag_override
      ADD CONSTRAINT "FK_feature_flag_override_user" FOREIGN KEY (user_id) REFERENCES "user"(id) ON DELETE CASCADE;
END $rekey_user$;

-- -----------------------------------------------------------------------------
-- 2. sermon — referenced by playlist_sermons_sermon."sermonId".
-- -----------------------------------------------------------------------------
DO $rekey_sermon$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM sermon WHERE substring(id::text, 15, 1) = '4') THEN
    RAISE NOTICE 'rekey 015: sermon has no v4 ids left — skipped';
    RETURN;
  END IF;

  ALTER TABLE playlist_sermons_sermon DROP CONSTRAINT IF EXISTS "FK_7fd858f1b2a29fa7a6a5ab2c77f";
  ALTER TABLE sermon DROP CONSTRAINT IF EXISTS "PK_5c7cabe5be42b0840c247c9f14c";

  ALTER TABLE sermon ADD COLUMN rekey_new_id uuid;
  UPDATE sermon SET rekey_new_id = uuidv7();

  UPDATE playlist_sermons_sermon c
     SET "sermonId" = p.rekey_new_id
    FROM sermon p
   WHERE c."sermonId" = p.id;

  UPDATE sermon SET id = rekey_new_id;
  ALTER TABLE sermon DROP COLUMN rekey_new_id;

  ALTER TABLE sermon
      ADD CONSTRAINT "PK_5c7cabe5be42b0840c247c9f14c" PRIMARY KEY (id);
  ALTER TABLE playlist_sermons_sermon
      ADD CONSTRAINT "FK_7fd858f1b2a29fa7a6a5ab2c77f" FOREIGN KEY ("sermonId") REFERENCES sermon(id) ON DELETE CASCADE;
END $rekey_sermon$;

-- -----------------------------------------------------------------------------
-- 3. playlist — referenced by playlist_sermons_sermon."playlistId" and
--    section_playlists_playlist."playlistId".
-- -----------------------------------------------------------------------------
DO $rekey_playlist$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM playlist WHERE substring(id::text, 15, 1) = '4') THEN
    RAISE NOTICE 'rekey 015: playlist has no v4 ids left — skipped';
    RETURN;
  END IF;

  ALTER TABLE playlist_sermons_sermon DROP CONSTRAINT IF EXISTS "FK_5ce6a49a1e80041f94cb5152fe3";
  ALTER TABLE section_playlists_playlist DROP CONSTRAINT IF EXISTS "FK_39bacf40bb28fa91cdf8c3e1eab";
  ALTER TABLE playlist DROP CONSTRAINT IF EXISTS "PK_538c2893e2024fabc7ae65ad142";

  ALTER TABLE playlist ADD COLUMN rekey_new_id uuid;
  UPDATE playlist SET rekey_new_id = uuidv7();

  UPDATE playlist_sermons_sermon c
     SET "playlistId" = p.rekey_new_id
    FROM playlist p
   WHERE c."playlistId" = p.id;
  UPDATE section_playlists_playlist c
     SET "playlistId" = p.rekey_new_id
    FROM playlist p
   WHERE c."playlistId" = p.id;

  UPDATE playlist SET id = rekey_new_id;
  ALTER TABLE playlist DROP COLUMN rekey_new_id;

  ALTER TABLE playlist
      ADD CONSTRAINT "PK_538c2893e2024fabc7ae65ad142" PRIMARY KEY (id);
  ALTER TABLE playlist_sermons_sermon
      ADD CONSTRAINT "FK_5ce6a49a1e80041f94cb5152fe3" FOREIGN KEY ("playlistId") REFERENCES playlist(id) ON UPDATE CASCADE ON DELETE CASCADE;
  ALTER TABLE section_playlists_playlist
      ADD CONSTRAINT "FK_39bacf40bb28fa91cdf8c3e1eab" FOREIGN KEY ("playlistId") REFERENCES playlist(id) ON DELETE CASCADE;
END $rekey_playlist$;

-- -----------------------------------------------------------------------------
-- 4. section — referenced by section_playlists_playlist."sectionId".
-- -----------------------------------------------------------------------------
DO $rekey_section$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM section WHERE substring(id::text, 15, 1) = '4') THEN
    RAISE NOTICE 'rekey 015: section has no v4 ids left — skipped';
    RETURN;
  END IF;

  ALTER TABLE section_playlists_playlist DROP CONSTRAINT IF EXISTS "FK_7e60b48429a43494fcd98f0a70a";
  ALTER TABLE section DROP CONSTRAINT IF EXISTS "PK_3c41d2d699384cc5e8eac54777d";

  ALTER TABLE section ADD COLUMN rekey_new_id uuid;
  UPDATE section SET rekey_new_id = uuidv7();

  UPDATE section_playlists_playlist c
     SET "sectionId" = p.rekey_new_id
    FROM section p
   WHERE c."sectionId" = p.id;

  UPDATE section SET id = rekey_new_id;
  ALTER TABLE section DROP COLUMN rekey_new_id;

  ALTER TABLE section
      ADD CONSTRAINT "PK_3c41d2d699384cc5e8eac54777d" PRIMARY KEY (id);
  ALTER TABLE section_playlists_playlist
      ADD CONSTRAINT "FK_7e60b48429a43494fcd98f0a70a" FOREIGN KEY ("sectionId") REFERENCES section(id) ON UPDATE CASCADE ON DELETE CASCADE;
END $rekey_section$;

-- -----------------------------------------------------------------------------
-- 5. feature_flag — referenced by feature_flag_override.flag_id.
-- -----------------------------------------------------------------------------
DO $rekey_feature_flag$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM feature_flag WHERE substring(id::text, 15, 1) = '4') THEN
    RAISE NOTICE 'rekey 015: feature_flag has no v4 ids left — skipped';
    RETURN;
  END IF;

  ALTER TABLE feature_flag_override DROP CONSTRAINT IF EXISTS "FK_feature_flag_override_flag";
  ALTER TABLE feature_flag DROP CONSTRAINT IF EXISTS "PK_feature_flag_id";

  ALTER TABLE feature_flag ADD COLUMN rekey_new_id uuid;
  UPDATE feature_flag SET rekey_new_id = uuidv7();

  UPDATE feature_flag_override c
     SET flag_id = p.rekey_new_id
    FROM feature_flag p
   WHERE c.flag_id = p.id;

  UPDATE feature_flag SET id = rekey_new_id;
  ALTER TABLE feature_flag DROP COLUMN rekey_new_id;

  ALTER TABLE feature_flag
      ADD CONSTRAINT "PK_feature_flag_id" PRIMARY KEY (id);
  ALTER TABLE feature_flag_override
      ADD CONSTRAINT "FK_feature_flag_override_flag" FOREIGN KEY (flag_id) REFERENCES feature_flag(id) ON DELETE CASCADE;
END $rekey_feature_flag$;

-- -----------------------------------------------------------------------------
-- 6. Leaf parents — no children reference their PK, so no temp column is
--    needed and no FK is dropped. Their own FK columns were already remapped
--    by the parent blocks above.
-- -----------------------------------------------------------------------------
DO $rekey_revoked_refresh_token$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM revoked_refresh_token WHERE substring(id::text, 15, 1) = '4') THEN
    RAISE NOTICE 'rekey 015: revoked_refresh_token has no v4 ids left — skipped';
    RETURN;
  END IF;

  ALTER TABLE revoked_refresh_token DROP CONSTRAINT IF EXISTS "PK_revoked_refresh_token";
  UPDATE revoked_refresh_token SET id = uuidv7();
  ALTER TABLE revoked_refresh_token
      ADD CONSTRAINT "PK_revoked_refresh_token" PRIMARY KEY (id);
END $rekey_revoked_refresh_token$;

DO $rekey_feature_flag_override$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM feature_flag_override WHERE substring(id::text, 15, 1) = '4') THEN
    RAISE NOTICE 'rekey 015: feature_flag_override has no v4 ids left — skipped';
    RETURN;
  END IF;

  ALTER TABLE feature_flag_override DROP CONSTRAINT IF EXISTS "PK_feature_flag_override_id";
  UPDATE feature_flag_override SET id = uuidv7();
  ALTER TABLE feature_flag_override
      ADD CONSTRAINT "PK_feature_flag_override_id" PRIMARY KEY (id);
END $rekey_feature_flag_override$;

DO $rekey_playlist_sermons_sermon$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM playlist_sermons_sermon WHERE substring(id::text, 15, 1) = '4') THEN
    RAISE NOTICE 'rekey 015: playlist_sermons_sermon has no v4 ids left — skipped';
    RETURN;
  END IF;

  ALTER TABLE playlist_sermons_sermon DROP CONSTRAINT IF EXISTS "PK_playlist_sermons_sermon_id";
  UPDATE playlist_sermons_sermon SET id = uuidv7();
  ALTER TABLE playlist_sermons_sermon
      ADD CONSTRAINT "PK_playlist_sermons_sermon_id" PRIMARY KEY (id);
END $rekey_playlist_sermons_sermon$;

DO $rekey_section_playlists_playlist$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM section_playlists_playlist WHERE substring(id::text, 15, 1) = '4') THEN
    RAISE NOTICE 'rekey 015: section_playlists_playlist has no v4 ids left — skipped';
    RETURN;
  END IF;

  ALTER TABLE section_playlists_playlist DROP CONSTRAINT IF EXISTS "PK_section_playlists_playlist_id";
  UPDATE section_playlists_playlist SET id = uuidv7();
  ALTER TABLE section_playlists_playlist
      ADD CONSTRAINT "PK_section_playlists_playlist_id" PRIMARY KEY (id);
END $rekey_section_playlists_playlist$;

-- Refresh planner statistics after the wholesale id rewrites (the PK indexes
-- and the FK indexes were rebuilt/churned, so the old estimates are stale).
ANALYZE;

COMMIT;
