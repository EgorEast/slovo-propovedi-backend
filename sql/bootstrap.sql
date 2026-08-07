-- =============================================================================
-- Bootstrap schema for the slovo-propovedi backend
-- =============================================================================
--
-- The backend used to auto-create its schema via TypeORM `synchronize: true`.
-- Since the switch to PgBouncer (transaction mode) — where DDL must not run
-- through the connection pooler — the schema is provisioned once from this
-- file instead (`synchronize: false` in `backend/src/db/typeorm.module.ts`).
--
-- When to run it:
--   * On a FRESH database only. Existing installations keep their schema
--     (it was created by TypeORM synchronize and matches this file exactly).
--   * As a database superuser or as the DB owner, e.g.:
--       psql -h <host> -U <user> -d <db> -f backend/sql/bootstrap.sql
--
-- The DDL below is exactly what TypeORM 0.3.17 `synchronize` produces for the
-- entities in `backend/src/**/*.entity.ts` (verified against a throwaway
-- instance). Constraint names are TypeORM's generated identifiers.
-- =============================================================================

-- uuid PKs are generated with uuid_generate_v4() (uuid-ossp), matching
-- TypeORM's default `uuidExtension: "uuid-ossp"`.
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;

-- ---------------------------------------------------------------------------
-- user (admin accounts)
-- ---------------------------------------------------------------------------
CREATE TABLE "user" (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    name character varying NOT NULL,
    email character varying NOT NULL,
    username character varying NOT NULL,
    password character varying NOT NULL
);

-- ---------------------------------------------------------------------------
-- sermon
-- ---------------------------------------------------------------------------
CREATE TABLE sermon (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    title character varying NOT NULL,
    description character varying NOT NULL,
    "text-file-url" character varying,
    "audio-url" character varying,
    "youtube-url" character varying,
    artist character varying NOT NULL,
    artwork character varying NOT NULL,
    book character varying,
    chapter integer,
    verse json
);

-- ---------------------------------------------------------------------------
-- section
-- ---------------------------------------------------------------------------
CREATE TABLE section (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    title character varying NOT NULL,
    description character varying,
    -- Global order of sections (drag-and-drop reordering on the admin dashboard).
    "position" integer NOT NULL DEFAULT 0,
    "items-size" character varying NOT NULL,
    "items-rows" integer,
    transform character varying NOT NULL,
    "is-description-title-on-slide-large" boolean DEFAULT false NOT NULL,
    "where-is-slide-title-located" character varying DEFAULT 'under'::character varying NOT NULL,
    "border-radius" boolean DEFAULT false NOT NULL
);

-- ---------------------------------------------------------------------------
-- playlist
-- ---------------------------------------------------------------------------
CREATE TABLE playlist (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    title character varying NOT NULL,
    description character varying NOT NULL,
    artwork character varying NOT NULL
);

-- ---------------------------------------------------------------------------
-- Many-to-many join tables
--
-- These are backed by explicit join entities (PlaylistSermonJoinEntity /
-- SectionPlaylistJoinEntity) with a surrogate `id` primary key plus a UNIQUE
-- constraint on the FK pair — the pair uniqueness preserves the old composite
-- PK invariant ("a sermon is in a playlist at most once").
-- ---------------------------------------------------------------------------
CREATE TABLE playlist_sermons_sermon (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    "playlistId" uuid NOT NULL,
    "sermonId" uuid NOT NULL,
    -- Order of sermons within a playlist (drag-and-drop reordering on the admin dashboard).
    "position" integer NOT NULL DEFAULT 0
);

CREATE TABLE section_playlists_playlist (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    "sectionId" uuid NOT NULL,
    "playlistId" uuid NOT NULL,
    -- Order of playlists within a section (drag-and-drop reordering on the admin dashboard).
    "position" integer NOT NULL DEFAULT 0
);

-- ---------------------------------------------------------------------------
-- Primary keys
-- ---------------------------------------------------------------------------
ALTER TABLE ONLY "user"
    ADD CONSTRAINT "PK_cace4a159ff9f2512dd42373760" PRIMARY KEY (id);
ALTER TABLE ONLY sermon
    ADD CONSTRAINT "PK_5c7cabe5be42b0840c247c9f14c" PRIMARY KEY (id);
ALTER TABLE ONLY section
    ADD CONSTRAINT "PK_3c41d2d699384cc5e8eac54777d" PRIMARY KEY (id);
ALTER TABLE ONLY playlist
    ADD CONSTRAINT "PK_538c2893e2024fabc7ae65ad142" PRIMARY KEY (id);
ALTER TABLE ONLY playlist_sermons_sermon
    ADD CONSTRAINT "PK_playlist_sermons_sermon_id" PRIMARY KEY (id);
ALTER TABLE ONLY section_playlists_playlist
    ADD CONSTRAINT "PK_section_playlists_playlist_id" PRIMARY KEY (id);

-- ---------------------------------------------------------------------------
-- Unique constraints
-- ---------------------------------------------------------------------------
ALTER TABLE ONLY "user"
    ADD CONSTRAINT "UQ_e12875dfb3b1d92d7d7c5377e22" UNIQUE (email);
ALTER TABLE ONLY "user"
    ADD CONSTRAINT "UQ_78a916df40e02a9deb1c4b75edb" UNIQUE (username);
ALTER TABLE ONLY playlist_sermons_sermon
    ADD CONSTRAINT "UQ_playlist_sermons_sermon_pair" UNIQUE ("playlistId", "sermonId");
ALTER TABLE ONLY section_playlists_playlist
    ADD CONSTRAINT "UQ_section_playlists_playlist_pair" UNIQUE ("sectionId", "playlistId");

-- ---------------------------------------------------------------------------
-- Indexes (join-table FK lookups)
-- ---------------------------------------------------------------------------
CREATE INDEX "IDX_5ce6a49a1e80041f94cb5152fe" ON playlist_sermons_sermon USING btree ("playlistId");
CREATE INDEX "IDX_7fd858f1b2a29fa7a6a5ab2c77" ON playlist_sermons_sermon USING btree ("sermonId");
CREATE INDEX "IDX_39bacf40bb28fa91cdf8c3e1ea" ON section_playlists_playlist USING btree ("playlistId");
CREATE INDEX "IDX_7e60b48429a43494fcd98f0a70" ON section_playlists_playlist USING btree ("sectionId");

-- ---------------------------------------------------------------------------
-- Foreign keys
-- ---------------------------------------------------------------------------
ALTER TABLE ONLY playlist_sermons_sermon
    ADD CONSTRAINT "FK_5ce6a49a1e80041f94cb5152fe3" FOREIGN KEY ("playlistId") REFERENCES playlist(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE ONLY playlist_sermons_sermon
    ADD CONSTRAINT "FK_7fd858f1b2a29fa7a6a5ab2c77f" FOREIGN KEY ("sermonId") REFERENCES sermon(id) ON DELETE CASCADE;
ALTER TABLE ONLY section_playlists_playlist
    ADD CONSTRAINT "FK_39bacf40bb28fa91cdf8c3e1eab" FOREIGN KEY ("playlistId") REFERENCES playlist(id) ON DELETE CASCADE;
ALTER TABLE ONLY section_playlists_playlist
    ADD CONSTRAINT "FK_7e60b48429a43494fcd98f0a70a" FOREIGN KEY ("sectionId") REFERENCES section(id) ON UPDATE CASCADE ON DELETE CASCADE;
