# Модуль `playlist` — плейлисты

Упорядоченные подборки проповедей. Модуль: CRUD, bulk-replace состава (`replacePlaylistSermons`), reorder проповедей внутри плейлиста (одиночный `CASE` UPDATE), синхронизация членства в разделах.

**Слой:** backend (module `playlist`)
**Статус:** актуально

## Эндпоинты

| Метод / путь | Guard | Body/Param | DTO ответа | Метод сервиса |
|---------------|-------|------------|------------|----------------|
| `POST /playlists` | ✅ `AuthGuard` + `RolesGuard` (admin, moderator) | `CreatePlaylistDto` | `PlaylistResponseDto` | `create` |
| `GET /playlists` | публичный | — | `AllPlaylistsResponseDto` | `findAll` |
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

## `create` (SERIALIZABLE)

- SERIALIZABLE-транзакция: сохраняет плейлист, затем — если `sermonsIds` задан — проверяет существование всех проповедей (`findByIds`), создаёт join-строки с позицией = индексу в массиве.
- Перечитывает после коммита (`findOne`) — ответ отражает полностью сохранённый плейлист.

## `update` и `replacePlaylistSermons`

- `update` обновляет только заданные поля (`title`/`description`/`artwork`), затем:
  - если `sermonsIds` задан → `replacePlaylistSermons(id, sermonsIds)` (bulk-replace состава);
  - если `sectionsIds` задан → `syncPlaylistSectionMembership(playlist, sectionsIds)`.

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
| `src/playlist/dto/create-playlist.dto.ts` | `{ title, description, artwork, sermonsIds? }` |
| `src/playlist/dto/update-playlist.dto.ts` | `{ title, description, artwork, sermonsIds, sectionsIds? }` |
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
