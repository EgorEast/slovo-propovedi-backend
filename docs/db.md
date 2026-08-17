# База данных: TypeORM, сущности, связи, миграции

Как backend подключается к PostgreSQL, какие сущности и связи описаны в TypeORM, как выглядит схема БД (ASCII-диаграмма) и как она провижионируется (ручной SQL вместо `synchronize`).

**Слой:** backend (persistence)
**Статус:** актуально

## TypeORM-конфиг: `src/db/typeorm.module.ts`

Модуль `TypeOrmModule` — чисто конфигурационный (без контроллера/сервиса), `forRootAsync` читает env через `ConfigService`.

| Параметр | Значение | Комментарий |
|----------|----------|-------------|
| `type` | `'postgres'` | СУБД |
| `host` | `POSTGRES_HOST` | в проде — `slovo-pgbouncer` (PgBouncer впереди) |
| `port` | `POSTGRES_PORT` (def `5432`) | в проде — `6432`; валидируется как integer |
| `username` / `password` / `database` | `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | подключение |
| `synchronize` | `false` | DDL не идёт через пулер |
| `installExtensions` | `false` | `CREATE EXTENSION uuid-ossp` — только в bootstrap.sql |
| `poolSize` | `5` | маленький клиентский пул (PgBouncer уже пулит) |
| `entities` | `src/**/*.entity.{js,ts}` + `node_modules/nestjs-admin/**/*.entity.js` | glob-автозагрузка сущностей |

> ⚠️ Три флага (`synchronize: false`, `installExtensions: false`, `poolSize: 5`) — осознанная настройка под **PgBouncer (transaction mode)**. Через пулер нельзя гонять DDL, поэтому схема провижионируется из SQL-файлов, а не из ORM-миграций. Подробная мотивация — комментарий в `typeorm.module.ts` и [`architecture.md`](./architecture.md).

## Сущности и связи

Семь сущностей загружаются по glob-шаблону. Все — с uuid-PK (`@PrimaryGeneratedColumn('uuid')`).

### `User` — таблица `user`

`src/users/entities/user.entity.ts`. Аккаунты с ролями (`admin` / `moderator` / `user`, см. [`modules/users.md`](./modules/users.md)).

| Колонка | Тип | Ограничения |
|---------|-----|-------------|
| `id` | uuid | PK |
| `name` | varchar | NOT NULL |
| `email` | varchar | UNIQUE |
| `username` | varchar | UNIQUE |
| `password` | varchar | bcrypt-хэш |
| `role` | varchar | NOT NULL, default `'user'`, CHECK `(role IN ('admin','moderator','user'))` |

### `RevokedRefreshToken` — таблица `revoked_refresh_token`

`src/auth/entities/revoked-refresh-token.entity.ts`. Denylist отозванных refresh-токенов — через `logout` **и ротацию** в `refreshTokens` (см. [`modules/auth.md`](./modules/auth.md)).

| Колонка | Тип | Ограничения |
|---------|-----|-------------|
| `id` | uuid | PK |
| `token_hash` | varchar | **UNIQUE** — ключ поиска denylist; guard от повторного logout и параллельной ротации (`ON CONFLICT DO NOTHING`) |
| `user_id` | uuid | FK → `user`(id), `ON DELETE CASCADE` |
| `revoked_at` | timestamptz | NOT NULL, default `now()` |
| `expires_at` | timestamptz | NOT NULL — зеркало `exp` токена; после этой даты токен и так просрочен, строка — мусор (чистится opportunistic purge) |

Хранится **sha256-хэш** токена, не сам токен — утечка БД не позволяет «оживить» refresh-токен.

### `SermonEntity` — таблица `sermon`

`src/sermon/entities/sermon.entity.ts`.

| Колонка | Тип | Ограничения |
|---------|-----|-------------|
| `id` | uuid | PK |
| `title` | varchar | NOT NULL |
| `description` | varchar | NOT NULL |
| `text-file-url` | varchar | nullable |
| `audio-url` | varchar | nullable |
| `youtube-url` | varchar | nullable |
| `artist` | varchar | NOT NULL |
| `artwork` | varchar | NOT NULL |
| `book` | varchar | nullable |
| `chapter` | json | nullable (`number \| number[]`) — одиночная глава или диапазон `[start, end]` |
| `verse` | json | nullable (`number \| number[] \| (number \| number[])[]`) — стих, диапазон или список отрезков `[[9,18],20]` |

Связь: `@OneToMany(() => PlaylistSermonJoinEntity, join => join.sermon, { cascade: true })` → `playlistJoins`.

### `PlaylistEntity` — таблица `playlist`

`src/playlist/entities/playlist.entity.ts`.

| Колонка | Тип | Ограничения |
|---------|-----|-------------|
| `id` | uuid | PK |
| `title` | varchar | NOT NULL |
| `description` | varchar | NOT NULL |
| `artwork` | varchar | NOT NULL |

Связи: `@OneToMany → SectionPlaylistJoinEntity` (`sectionJoins`, cascade), `@OneToMany → PlaylistSermonJoinEntity` (`sermonJoins`, cascade).

### `PlaylistSermonJoinEntity` — таблица `playlist_sermons_sermon`

`src/playlist/entities/playlist-sermon-join.entity.ts`. Join «проповедь в плейлисте» с порядком.

| Колонка | Тип | Ограничения |
|---------|-----|-------------|
| `id` | uuid | PK (суррогатный) |
| `playlistId` | uuid | FK → playlist, CASCADE; UNIQUE(`playlistId`,`sermonId`) |
| `sermonId` | uuid | FK → sermon, CASCADE |
| `position` | int | NOT NULL default 0 |

### `SectionEntity` — таблица `section`

`src/section/entities/section.entity.ts`. См. enums и колонки в [`modules/section.md`](./modules/section.md).

| Колонка | Тип | Ограничения |
|---------|-----|-------------|
| `id` | uuid | PK |
| `title` | varchar | NOT NULL |
| `description` | varchar | nullable |
| `position` | int | NOT NULL default 0 (глобальный порядок) |
| `items-size` / `transform` | varchar | enums |
| `items-rows` | int | nullable |
| `is-description-title-on-slide-large` | boolean | default false |
| `where-is-slide-title-located` | varchar | default `'under'` |
| `border-radius` | boolean | default false |

Связь: `@OneToMany → SectionPlaylistJoinEntity` (`playlistJoins`, cascade).

### `SectionPlaylistJoinEntity` — таблица `section_playlists_playlist`

`src/section/entities/section-playlist-join.entity.ts`. Join «плейлист в разделе».

| Колонка | Тип | Ограничения |
|---------|-----|-------------|
| `id` | uuid | PK (суррогатный) |
| `sectionId` | uuid | FK → section, CASCADE; UNIQUE(`sectionId`,`playlistId`) |
| `playlistId` | uuid | FK → playlist, CASCADE |
| `position` | int | NOT NULL default 0 |

## Карта отношений (ASCII ER)

```
 user
 ──────────────
  id (PK, uuid)
  name
  email (UQ)
  username (UQ)
  password            (bcrypt)
  role                (default 'user', CHECK admin/moderator/user)
  │
  │ 1:N
  ▼
 revoked_refresh_token
 ──────────────
  id (PK, uuid)
  token_hash (UQ)     (sha256 хэш refresh-токена, denylist logout)
  user_id (FK -> user, CASCADE)
  revoked_at          (default now())
  expires_at          (= exp токена)

 sermon ────────────────────────────┐
 ──────────────                     │ 1:N
  id (PK, uuid)                     │
  title                             ▼
  description        ┌────────────────────────────────┐
  text-file-url      │ playlist_sermons_sermon        │
  audio-url          │  id (PK, uuid)  -- surrogate   │
  youtube-url        │  "playlistId" (FK -> playlist) │  N:1
  artist             │  "sermonId"   (FK -> sermon)   │
  artwork            │  position                      │
  book               └────────────────────────────────┘
  chapter                        ▲
  verse                           │ 1:N
                                  │
 playlist ────────────────────────┘
 ──────────────
  id (PK, uuid)
  title
  description
  artwork
                                  ▲
                                  │ 1:N
  ┌─────────────────────────────────────┐
  │ section_playlists_playlist          │
  │  id (PK, uuid)  -- surrogate        │
  │  "sectionId" (FK -> section)        │  N:1
  │  "playlistId" (FK -> playlist)      │
  │  position                           │
  └─────────────────────────────────────┘
            ▲
            │ 1:N
 section ───┘
 ──────────────
  id (PK, uuid)
  title
  description
  position
  items-size / items-rows
  transform
  is-description-title-on-slide-large
  where-is-slide-title-located
  border-radius
```

Связи по `position` (drag-and-drop): `section.position` — глобальный порядок разделов; `playlist_sermons_sermon.position` — порядок проповедей в плейлисте; `section_playlists_playlist.position` — порядок плейлистов в разделе.

> ✅ Сервисы нормализуют отношения на уровне БД: `order`-объекты в `find`/QueryBuilder сортируют join-ы по `position` ASC, чтобы не пересортировывать в памяти (`SERMON_ORDER`, `PLAYLIST_ORDER`, `SECTION_ORDER`).

## Ручной SQL вместо миграций TypeORM

Поскольку `synchronize: false`, DDL выполняется вручную. Полный набор:

| Файл | Что делает |
|------|------------|
| `sql/bootstrap.sql` | **свежая БД**: `CREATE EXTENSION "uuid-ossp"`, таблицы `user`, `revoked_refresh_token`, `sermon`, `section`, `playlist`, join-таблицы `playlist_sermons_sermon` + `section_playlists_playlist` (суррогатный `id` PK + UNIQUE FK-пара + `position`), PK, UNIQUE (`user.email`, `user.username`, `revoked_refresh_token.token_hash`, join-пары), 4 btree-индекса на FK-колонках, FK с `ON DELETE/UPDATE CASCADE` (включая `revoked_refresh_token.user_id → user(id)`). Идентичен выходу TypeORM `synchronize` для 0.3.17 (плюс hand-maintained имена констрейнтов). |
| `sql/migrate-add-username.sql` | **существующие БД** (2026-08-06): `ADD COLUMN IF NOT EXISTS username`, backfill NULL→`'admin'` (совпадает с playbook-var `slovo_admin_user_username`), `SET NOT NULL`, пересоздание UNIQUE `UQ_78a916df40e02a9deb1c4b75edb`. Идемпотентен. |
| `sql/migrations/001_add_positions.sql` | **существующие БД** (2026-08-07): `ADD COLUMN IF NOT EXISTS position` на `section`, `playlist_sermons_sermon`, `section_playlists_playlist`; конвертация join-таблиц с составного PK на суррогатный `id` (DO-блоки, идемпотентно); backfill позиций через `ROW_NUMBER()` (guard `WHERE position = 0`); индекс `idx_section_position`. Идемпотентен. |
| `sql/migrations/002_add_user_roles.sql` | **существующие БД** (2026-08-14): `ADD COLUMN IF NOT EXISTS role` на `user`; backfill `NULL → 'admin'` (все прежние аккаунты были неявными админами); `SET DEFAULT 'user'` (least privilege для новых); `SET NOT NULL`; CHECK `user_role_check` (DO-блок, идемпотентно). Идемпотентен. |
| `sql/migrations/003_revoked_refresh_tokens.sql` | **существующие БД** (2026-08-14): `CREATE TABLE IF NOT EXISTS revoked_refresh_token`; PK, UNIQUE `token_hash`, FK `user_id → user(id) ON DELETE CASCADE` — каждый в DO-блоке с guard по `pg_constraint` (идемпотентно; на fresh-bootstrap БД — no-op). Идемпотентен. |
| `sql/migrations/004_fix_db_collation.md` | **заметка-требование к провижионингу** (2026-08-14, не SQL-миграция): БД должна создаваться с UTF-8-локалью (`--locale=ru_RU.UTF-8` / `en_US.UTF-8` при `initdb`/`POSTGRES_INITDB_ARGS`), иначе `ILIKE`/`lower()` не сворачивают регистр кириллицы (`LC_CTYPE=C`/`POSIX`). Диагностика + пересоздание существующей БД с дампом — в файле. |
| `sql/migrations/005_sermon_search_tsvector.sql` | **существующие БД** (2026-08-14): генерируемая колонка `sermon.search_vector` (`GENERATED ALWAYS AS ... STORED`, выражение — взвешенный `to_tsvector('russian', ...)` по title/artist/book/description) + GIN-индекс `IDX_sermon_search_vector`. Требует **PostgreSQL >= 12** (generated columns). Идемпотентен (`ADD COLUMN IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS`). |
| `sql/migrations/006_playlist_search_tsvector.sql` | **существующие БД** (2026-08-16): генерируемая колонка `playlist.search_vector` (`GENERATED ALWAYS AS ... STORED`, выражение — взвешенный `to_tsvector('russian', ...)` по title (A) / description (D)) + GIN-индекс `IDX_playlist_search_vector`. Требует **PostgreSQL >= 12** (generated columns). Идемпотентен (`ADD COLUMN IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS`). |
| `sql/migrations/007_chapter_range.sql` | **существующие БД** (2026-08-17): `sermon.chapter` `integer → json` (поддержка диапазона глав, OpenAPI 0.12.0): `ALTER TABLE ... TYPE json USING to_json(chapter)` — одиночное значение остаётся JSON-числом (`3`), диапазон становится JSON-массивом (`[10, 11]`), как у соседней колонки `verse`. DO-блок с guard по `information_schema` (`data_type = 'integer'`) — идемпотентен; на fresh-bootstrap БД (уже `json`) — no-op. Revert: `ALTER TABLE sermon ALTER COLUMN chapter TYPE integer USING (chapter::text)::integer` (падает на строках с массивом — их нужно отредактировать). |

Команды применения (как DB-owner):

```bash
# свежая БД
psql -h <host> -U <user> -d <db> -f sql/bootstrap.sql

# существующие установки — поочерёдно
psql -h <host> -U <user> -d <db> -f sql/migrate-add-username.sql
psql -h <host> -U <user> -d <db> -f sql/migrations/001_add_positions.sql
psql -h <host> -U <user> -d <db> -f sql/migrations/002_add_user_roles.sql
psql -h <host> -U <user> -d <db> -f sql/migrations/003_revoked_refresh_tokens.sql
psql -h <host> -U <user> -d <db> -f sql/migrations/005_sermon_search_tsvector.sql
psql -h <host> -U <user> -d <db> -f sql/migrations/006_playlist_search_tsvector.sql
psql -h <host> -U <user> -d <db> -f sql/migrations/007_chapter_range.sql
```

> ⚠️ **Нет TypeORM migration runner и нет npm-скрипта миграций.** Применение — строго ручное через `psql`. Новые изменения схемы оформлять идемпотентным SQL-файлом и синхронно отражать в `bootstrap.sql`.

## Связанные документы

- [README.md](./README.md) — индекс документации backend-репозитория
- [architecture.md](./architecture.md) — env, bootstrap
- [conventions.md](./conventions.md) — паттерны сущностей, SERIALIZABLE, SQL-миграции
- [modules/sermon.md](./modules/sermon.md) — сервис проповедей (поиск, normalize)
- [modules/section.md](./modules/section.md) — enums разделов, reorder
- [contracts/rest-api.md](./contracts/rest-api.md) — контракт, из которого генерируются типы
