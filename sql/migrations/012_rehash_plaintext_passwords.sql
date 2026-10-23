-- =============================================================================
-- Migration 012: rehash legacy plaintext passwords (2026-10-23)
-- =============================================================================
--
-- Purpose:
--   Older databases may still store user passwords as plaintext. The
--   application no longer has a plaintext comparison path (AUTH M-5 / INJ L3):
--   a non-bcrypt `user.password` is treated as invalid credentials and a
--   warning is logged. This migration converts every such row to a bcrypt hash
--   IN PLACE, preserving the credential — users keep their existing passwords.
--
-- Idempotency:
--   The WHERE clause targets only values that are NOT bcrypt hashes produced by
--   the application (prefixes $2a$, $2b$, $2y$, matching BCRYPT_PREFIXES in
--   src/auth/auth.service.ts). Re-running the file leaves bcrypt rows
--   untouched, so it is safe to execute more than once.
--
-- Requirement: pgcrypto (for crypt() + gen_salt('bf', 10), i.e. bcrypt cost 10,
-- the same cost as UsersService.BCRYPT_ROUNDS). CREATE EXTENSION needs a
-- superuser or a trusted extension; run as the DB owner:
--   psql -h <host> -U <user> -d <db> -f sql/migrations/012_rehash_plaintext_passwords.sql
--
-- FALLBACK if pgcrypto cannot be enabled:
--   Do NOT deploy with plaintext rows. Replace them with an unusable bcrypt
--   hash and force those users through a password reset instead, e.g.
--     UPDATE "user"
--     SET password = '$2b$10$96rsAYi/v./SGUcJ9JHoDOkR8tt0qWivRBwqIG0M6n56i1HBNwHlS'
--     WHERE password NOT LIKE '$2a$%' AND password NOT LIKE '$2b$%' AND password NOT LIKE '$2y$%';
--   (That constant is the valid cost-10 dummy hash from auth.service.ts; login
--   then fails with the generic 401 and the user resets the password via the
--   existing admin flow.)
--
-- Run BEFORE deploying the matching application tag: from that tag on, non-bcrypt
-- rows cannot authenticate. The migration itself never bumps token_version, so
-- existing sessions of rehashed users stay valid (credentials did not change).
--
-- REVERT:
--   Not possible — plaintext is intentionally destroyed. Restore from a backup
--   if a rollback is required before users have rotated their credentials.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

UPDATE "user"
SET password = crypt(password, gen_salt('bf', 10))
WHERE password NOT LIKE '$2a$%'
  AND password NOT LIKE '$2b$%'
  AND password NOT LIKE '$2y$%';
