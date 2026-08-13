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

Шесть сущностей загружаются по glob-шаблону. Все — с uuid-PK (`@PrimaryGeneratedColumn('uuid')`).

### `User` — таблица `user`

`src/users/entities/user.entity.ts`. Админ-аккаунты.

| Колонка | Тип | Ограничения |
|---------|-----|-------------|
| `id` | uuid | PK |
| `name` | varchar | NOT NULL |
| `email` | varchar | UNIQUE |
| `username` | varchar | UNIQUE |
| `password` | varchar | bcrypt-хэш |

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
| `chapter` | int | nullable |
| `verse` | json | nullable (`number \| number[]`) |

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
| `sql/bootstrap.sql` | **свежая БД**: `CREATE EXTENSION "uuid-ossp"`, таблицы `user`, `sermon`, `section`, `playlist`, join-таблицы `playlist_sermons_sermon` + `section_playlists_playlist` (суррогатный `id` PK + UNIQUE FK-пара + `position`), PK, UNIQUE (`user.email`, `user.username`, join-пары), 4 btree-индекса на FK-колонках, 4 FK с `ON DELETE/UPDATE CASCADE`. Идентичен выходу TypeORM `synchronize` для 0.3.17. |
| `sql/migrate-add-username.sql` | **существующие БД** (2026-08-06): `ADD COLUMN IF NOT EXISTS username`, backfill NULL→`'admin'` (совпадает с playbook-var `slovo_admin_user_username`), `SET NOT NULL`, пересоздание UNIQUE `UQ_78a916df40e02a9deb1c4b75edb`. Идемпотентен. |
| `sql/migrations/001_add_positions.sql` | **существующие БД** (2026-08-07): `ADD COLUMN IF NOT EXISTS position` на `section`, `playlist_sermons_sermon`, `section_playlists_playlist`; конвертация join-таблиц с составного PK на суррогатный `id` (DO-блоки, идемпотентно); backfill позиций через `ROW_NUMBER()` (guard `WHERE position = 0`); индекс `idx_section_position`. Идемпотентен. |

Команды применения (как DB-owner):

```bash
# свежая БД
psql -h <host> -U <user> -d <db> -f sql/bootstrap.sql

# существующие установки — поочерёдно
psql -h <host> -U <user> -d <db> -f sql/migrate-add-username.sql
psql -h <host> -U <user> -d <db> -f sql/migrations/001_add_positions.sql
```

> ⚠️ **Нет TypeORM migration runner и нет npm-скрипта миграций.** Применение — строго ручное через `psql`. Новые изменения схемы оформлять идемпотентным SQL-файлом и синхронно отражать в `bootstrap.sql`.

## Связанные документы

- [README.md](./README.md) — индекс документации backend-репозитория
- [architecture.md](./architecture.md) — env, bootstrap
- [conventions.md](./conventions.md) — паттерны сущностей, SERIALIZABLE, SQL-миграции
- [modules/sermon.md](./modules/sermon.md) — сервис проповедей (поиск, normalize)
- [modules/section.md](./modules/section.md) — enums разделов, reorder
- [contracts/rest-api.md](./contracts/rest-api.md) — контракт, из которого генерируются типы
