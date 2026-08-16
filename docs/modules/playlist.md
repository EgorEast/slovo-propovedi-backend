# Модуль `playlist` — плейлисты

Упорядоченные подборки проповедей. Модуль: CRUD, bulk-replace состава (`replacePlaylistSermons`), reorder проповедей внутри плейлиста (одиночный `CASE` UPDATE), синхронизация членства в разделах.

**Слой:** backend (module `playlist`)
**Статус:** актуально

## Эндпоинты

| Метод / путь | Guard | Body/Param | DTO ответа | Метод сервиса |
|---------------|-------|------------|------------|----------------|
| `POST /playlists` | ✅ `AuthGuard` + `RolesGuard` (admin, moderator) | `CreatePlaylistDto` | `PlaylistResponseDto` | `create` |
| `GET /playlists` | публичный | query `FindAllPlaylistsQueryDto` (`search?`) | `AllPlaylistsResponseDto` | `findAll(search)` |
| `GET /playlists/:id` | публичный | `IdParamDto` | `PlaylistResponseDto` | `findOne` |
| `PATCH /playlists/:id/sermons/reorder` | ✅ `AuthGuard` + `RolesGuard` (admin, moderator) | `IdParamDto` + `ReorderSermonsInPlaylistDto` | `StatusPlaylistResponseDto` | `reorderSermonsInPlaylist(id, sermonIds)` |
| `PATCH /playlists/:id` | ✅ `AuthGuard` + `RolesGuard` (admin, moderator) | `IdParamDto` + `UpdatePlaylistDto` | `PlaylistResponseDto` | `update` |
| `DELETE /playlists/:id` | ✅ `AuthGuard` + `RolesGuard` (admin, moderator) | `IdParamDto` | `StatusPlaylistResponseDto` | `remove` |

`@Controller('playlists')` (`src/playlist/playlist.controller.ts`).

## Сущности

### `PlaylistEntity` — таблица `playlist`

`src/playlist/entities/playlist.entity.ts`.

| Поле | Колонка | Тип | Примечание |
|------|---------|-----|------------|
| `id` | `id` | uuid | PK |
| `title` / `description` / `artwork` | — | varchar | NOT NULL |
| `sectionJoins` | relation | — | `@OneToMany → SectionPlaylistJoinEntity`, cascade |
| `sermonJoins` | relation | — | `@OneToMany → PlaylistSermonJoinEntity`, cascade |

### `PlaylistSermonJoinEntity` — таблица `playlist_sermons_sermon`

`src/playlist/entities/playlist-sermon-join.entity.ts`. Join «проповедь в плейлисте» с порядком.

| Колонка | Тип | Ограничения |
|---------|-----|-------------|
| `id` | uuid | PK (суррогатный) |
| `playlistId` | uuid | FK → playlist, CASCADE; UNIQUE(`playlistId`,`sermonId`) |
| `sermonId` | uuid | FK → sermon, CASCADE |
| `position` | int | NOT NULL default 0 |

Сервис тянет `PLAYLIST_RELATIONS` и нормализует в `NormalizedPlaylistResponse` (`normalizePlaylist`), сортируя `sermonJoins` и `sectionJoins` по `position` на уровне БД (`PLAYLIST_ORDER`).

## `findAll` — полная выборка и полнотекстовый поиск (`playlist.service.ts`)

Сигнатура: `findAll(search?)`. Два пути:

| Условие | Путь | Как фильтрует |
|---------|------|----------------|
| `search` не задан | **полная выборка** | `findAndCount` (как до поиска — поведение без изменений) |
| `search` задан | **поиск** | QueryBuilder (`getManyAndCount`): `playlist.search_vector @@ tsquery`, порядок по релевантности |

### Полнотекстовый поиск (FTS)

Поиск — **независимый от порядка слов** (AND по всем словам запроса) и **ранжированный по релевантности**, на PostgreSQL full-text search (`russian` конфигурация):

- Все поисковые поля свёрнуты в **генерируемую колонку** `playlist.search_vector` (`GENERATED ALWAYS AS ... STORED`, PostgreSQL >= 12) с весами `setweight`:
  - `A` — `title` (наивысший приоритет);
  - `D` — `description` (наинизший).
- Веса — **единый источник правды** в коде: `PLAYLIST_SEARCH_WEIGHTS` + `buildPlaylistSearchVectorExpression()` (`src/playlist/playlist.service.ts`); SQL-миграция [`sql/migrations/006_playlist_search_tsvector.sql`](../../sql/migrations/006_playlist_search_tsvector.sql) и `sql/bootstrap.sql` используют то же выражение (дрейф ловится спеками).
- Ранжирование: `ts_rank('{0.1,0.2,0.4,1.0}'::float4[], playlist.search_vector, tsquery)` — массив весов в порядке **D, C, B, A** (description 0.1, title 1.0; неиспользуемые C/B — дефолт 0.2/0.4). Тот же массив, что в sermon-поиске.
- GIN-индекс `"IDX_playlist_search_vector"` покрывает `search_vector @@ tsquery` (миграция 006 + `sql/bootstrap.sql`).

### Санитизация на границе (parse, don't validate)

`buildSearchTsQuery` — **переиспользуется из sermon-сервиса** (`src/sermon/sermon.service`), не дублируется: та же чистая функция на границе строит tsquery из строки поиска (только буквы/цифры, `:*` на каждом токене, AND между токенами — порядок слов не важен). Строка без единого словного символа (`"&&&"`) → `BadRequestException` (fail fast). Подробности — [`sermon.md`](./sermon.md).

### Условие и ранжирование

`tsquery` строится **один раз на запрос** и биндится параметром `:tsquery`; выражение оборачивается в `to_tsquery('russian', ...)` (стеммер применяется и к запросу, и к вектору):

```ts
PLAYLIST_TS_SEARCH_CONDITION = "playlist.search_vector @@ to_tsquery('russian', :tsquery)";
RANK_EXPRESSION = "ts_rank('{0.1,0.2,0.4,1.0}'::float4[], playlist.search_vector, to_tsquery('russian', :tsquery))";
```

Порядок: **`rank DESC` → `playlist.id DESC`** → позиции join-ов (`sermonJoins.position`, `sectionJoins.position`) на уровне БД — та же реляционная модель, что у `findAndCount`.

> ✅ `findAll` без `search` отдаёт **всю** выборку (backward-compat); форма ответа `{ playlists, count }` не изменилась ни в одном из путей.

## `create` (SERIALIZABLE)

- SERIALIZABLE-транзакция: сохраняет плейлист, затем — если `sermonsIds` задан — проверяет существование всех проповедей (`findByIds`), создаёт join-строки с позицией = индексу в массиве.
- **`description: null` → `''`.** Схема `PlaylistControllerCreateBody` допускает `description: null`, но колонка `playlist.description` в БД — `NOT NULL` (см. [`../db.md`](../db.md), `sql/bootstrap.sql`), поэтому сервис приводит `null` к пустой строке на границе: `description: dto.description ?? ''`. Иначе INSERT с `NULL` падал бы HTTP 500 (нарушение not-null constraint).
- Если `sectionsIds` задан — валидация в той же транзакции (зеркало `sermonsIds`-флоу): дубликаты → `400 Bad Request` (`Duplicate section IDs detected`), несуществующий раздел → `404 Not Found` (`Some sections not found`). Ошибка откатывает транзакцию — плейлист не сохраняется.
- После коммита, если `sectionsIds` задан — прикрепление к разделам через `attachPlaylistToSections` (SERIALIZABLE, `max(position) + 1`); пустой/отсутствующий массив — no-op. Паттерн «attach после create-транзакции» зеркалит `SermonService.create` → `attachSermonToPlaylists` (хелпер сам открывает SERIALIZABLE-транзакцию, поэтому не вызывается внутри create-транзакции).
- Перечитывает после коммита (`findOne`) — ответ отражает полностью сохранённый плейлист.

## `update` и `replacePlaylistSermons`

- `update` обновляет только заданные поля (`title`/`description`/`artwork`), затем:
  - если `sermonsIds` задан → `replacePlaylistSermons(id, sermonsIds)` (bulk-replace состава);
  - если `sectionsIds` задан → `syncPlaylistSectionMembership(playlist, sectionsIds)`.
- Если `description` задан и равен `null` — то же приведение, что в `create`: `playlist.description = dto.description ?? ''` (UPDATE с `NULL` нарушил бы `NOT NULL` так же, как INSERT).

`replacePlaylistSermons` — **delete + reinsert в одной транзакции**, чтобы сбой вставки не оставил плейлист без проповедей:

```ts
await this.dataSource.transaction(async (manager) => {
  const joinRepository = manager.getRepository(PlaylistSermonJoinEntity);
  await joinRepository.delete({ playlistId });
  if (sermonIds.length === 0) return;
  const joinRows = sermonIds.map((sermonId, index) =>
    joinRepository.create({ playlistId, sermonId, position: index }),
  );
  await joinRepository.save(joinRows);
});
```

> ✅ Bulk-replace: `PATCH /playlists/:id` с `{ sermonsIds: [...] }` **заменяет** весь состав плейлиста (перезаписывает `position` индексами массива), а не патчит точечно.

## `reorderSermonsInPlaylist(playlistId, sermonIds)`

- Валидирует: массив не пуст, без дубликатов, и **полный in-scope набор** (`sermonIds.length === total` по `playlistId`) — иначе `BadRequestException` (частичный список «схлопнул» бы позиции).
- Проверяет, что все проповеди реально в плейлисте.
- **Одиночный `CASE id` UPDATE** позиций вместо N запросов:

```ts
const positionCase = sermonIds
  .map((sermonId, index) => {
    const join = joinBySermonId.get(sermonId);
    if (!join) throw new NotFoundException(...);
    return `WHEN '${join.id}' THEN ${index}`;
  })
  .join(' ');
await joinRepository.createQueryBuilder()
  .update(PlaylistSermonJoinEntity)
  .set({ position: () => `CASE id ${positionCase} END` })
  .where('id IN (:...ids)', { ids: joins.map((join) => join.id) })
  .execute();
```

> ✅ `join.id` — uuid, генерируется БД, поэтому интерполяция в CASE безопасна.

## `syncPlaylistSectionMembership`

Аналогична `syncSermonPlaylistMembership`: разница текущих `sectionJoins` и желаемого набора `sectionsIds` → удаление лишних, добавление недостающих через `attachPlaylistToSections` (SERIALIZABLE, `max(position) + 1`).

## `remove`

`delete(id)` → `{ status: 'success' }`. Каскады по join-таблицам — на стороне БД.

## DTO

| Файл | Схема |
|------|-------|
| `src/playlist/dto/create-playlist.dto.ts` | `{ title, description, artwork, sermonsIds?, sectionsIds? }` |
| `src/playlist/dto/update-playlist.dto.ts` | `{ title, description, artwork, sermonsIds, sectionsIds? }` |
| `src/playlist/dto/find-all-playlists-query.dto.ts` | extends query + `.extend({ search: z.string().trim().min(1).optional() })` |
| `src/playlist/dto/reorder-sermons-in-playlist.dto.ts` | `{ sermonIds: uuid[] }` |
| `src/playlist/dto/playlist-response.dto.ts` | create/findOne |
| `src/playlist/dto/all-playlists-response.dto.ts` | findAll |
| `src/playlist/dto/status-playlist-response.dto.ts` | remove |

## Связанные документы

- [README.md](./README.md) — индекс модулей
- [sermon.md](./sermon.md) — проповеди и их membership-синхронизация
- [section.md](./section.md) — разделы и `section_playlists_playlist`
- [shared.md](./shared.md) — `IdParamDto`
- [../db.md](../db.md) — сущности и связи
- [../contracts/rest-api.md](../contracts/rest-api.md) — контракт `PlaylistController*`
- Домен playlists на фронте — репозиторий `slovo-propovedi-admin`
