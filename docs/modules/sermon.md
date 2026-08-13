# Модуль `sermon` — проповеди

Проповедь — основная единица контента. Модуль: CRUD, поиск (`ILIKE`), keyset-пагинация (`take`/`cursor`), presigned-URL аудио, синхронизация членства в плейлистах.

**Слой:** backend (module `sermon`)
**Статус:** актуально

## Эндпоинты

| Метод / путь | Guard | Query/Body/Param | DTO ответа | Метод сервиса |
|---------------|-------|------------------|------------|----------------|
| `POST /sermons` | ✅ `AuthGuard` | body `CreateSermonDto` | `SermonResponseDto` | `create` |
| `GET /sermons` | публичный | query `FindAllSermonsQueryDto` | `AllSermonsResponseDto` | `findAll(take, cursor, search)` |
| `GET /sermons/:id` | публичный | param `IdParamDto` | `SermonResponseDto` | `findOne` |
| `GET /sermons/:id/stream-url` | публичный | param `IdParamDto` | `StreamUrlResponseDto` | `getStreamUrl` |
| `PATCH /sermons/:id` | ✅ `AuthGuard` | param + body `UpdateSermonDto` | `StatusSermonResponseDto` | `update` |
| `DELETE /sermons/:id` | ✅ `AuthGuard` | param `IdParamDto` | `StatusSermonResponseDto` | `remove` |

`@Controller('sermons')` (`src/sermon/sermon.controller.ts`).

## Сущность `SermonEntity` (`src/sermon/entities/sermon.entity.ts`)

Таблица `sermon`. Полная карта колонок — в [`../db.md`](../db.md); ключевое:

| Поле | Колонка | Тип | Примечание |
|------|---------|-----|------------|
| `id` | `id` | uuid | PK |
| `title` / `description` / `artist` / `artwork` | — | varchar | NOT NULL |
| `textFileUrl` / `audioUrl` / `youtubeUrl` | `text-file-url` / `audio-url` / `youtube-url` | varchar | nullable |
| `book` | `book` | varchar | nullable |
| `chapter` | `chapter` | int | nullable |
| `verse` | `verse` | json | nullable (`number \| number[]`) |
| `playlistJoins` | relation | — | `@OneToMany → PlaylistSermonJoinEntity`, cascade |

Сервис тянет глубокие отношения (`SERMON_RELATIONS` — до плейлистов, разделов и вложенных проповедей) и нормализует их в `NormalizedSermonResponse` (`normalizeSermonRelations` / `normalizePlaylistRelations`), сортируя join-ы по `position` на уровне БД (`SERMON_RELATION_ORDER`).

## `findAll` — полная выборка и keyset-пагинация (`sermon.service.ts`)

Сигнатура: `findAll(take?, cursor?, search?)`. Два пути:

| Условие | Путь | Как фильтрует |
|---------|------|----------------|
| `take` не задан | **полная выборка** | `findAndCount` + `ILike` OR-массив по `SEARCH_FIELDS` |
| `take` задан | **keyset (cursor)** | QueryBuilder: `sermon.id < :cursor`, `take + 1` строк, escaped `ILIKE` OR-условие |

Общий список поисковых полей — один источник правды:

```ts
private static readonly SEARCH_FIELDS = ['title', 'artist', 'book', 'description'] as const;
```

- Поисковый термин нормализуется на границе: `const q = search ? \`%${escapeLike(search)}%\` : undefined;`
- `escapeLike` экранирует метасимволы `ILIKE` (`\`, `%`, `_`), чтобы пользовательский ввод вроде `"100%"` матчился буквально:

```ts
const escapeLike = (s: string) => s.replace(/[\\%_]/g, '\\$&');
```

- **Keyset-путь:** вместо `OFFSET` (пересканирует и пропускает строки) берёт `take + 1` строк после курсора; лишняя строка решает, есть ли следующая страница. `nextCursor` — `id` последней отданной проповеди.

```ts
if (cursor) queryBuilder.andWhere('sermon.id < :cursor', { cursor });
if (q) {
  const searchCondition = SEARCH_FIELDS.map((f) => `sermon.${f} ILIKE :q`).join(' OR ');
  queryBuilder.andWhere(searchCondition, { q });
}
const rows = await queryBuilder.getMany();
const hasMore = rows.length > take;
const sermons = hasMore ? rows.slice(0, take) : rows;
```

Ответ полной выборки: `{ sermons, count, nextCursor: null }`; keyset: `{ sermons, count: null, nextCursor }`.

> ✅ `findAll` без `take`/`search` отдаёт **всю** выборку (backward-compat, используется админкой при первичной загрузке). Поиск применён в **обоих** путях.

## `create` (SERIALIZABLE) и привязка к плейлистам

- `create` сохраняет проповедь, затем `attachSermonToPlaylists(savedSermon, playlistsIds)`.
- Привязка к плейлистам — **SERIALIZABLE**-транзакция: для каждого плейлиста `max(position)`, новая позиция `(max ?? -1) + 1` — защита от конкурентных дублей позиций.

## `update` и `syncSermonPlaylistMembership`

- `update` строит `updateFields` только из заданных полей (по `!== undefined`) и `sermonRepository.update(id, updateFields)`.
- Затем `syncSermonPlaylistMembership(existingSermon, playlistsIds)`: разница текущих join-ов и желаемого набора — удаляет лишние, добавляет недостающие (`attachSermonToPlaylists`). Возвращает `{ status: 'success' }`.

## `getStreamUrl`

`findOne` по `id` (иначе `NotFoundException`), требует `audioUrl` (иначе `NotFoundException`), вытаскивает имя объекта из URL через `MinioService.extractFileNameFromUrl`, отдаёт `getPresignedFileUrl` → `{ url }`. Подробнее — [`minio.md`](./minio.md).

## `remove`

`delete(id)` → `{ status: 'success' }`.

## DTO

| Файл | Схема |
|------|-------|
| `src/sermon/dto/create-sermon.dto.ts` | `SermonControllerCreateBody` |
| `src/sermon/dto/update-sermon.dto.ts` | `SermonControllerUpdateBody` |
| `src/sermon/dto/find-all-sermons-query.dto.ts` | extends query + `.extend({ take: z.coerce.number().int().min(1).max(100).optional(), search: z.string().trim().min(1).optional() })` |
| `src/sermon/dto/sermon-response.dto.ts` | create/findOne |
| `src/sermon/dto/all-sermons-response.dto.ts` | findAll |
| `src/sermon/dto/stream-url-response.dto.ts` | stream-url |
| `src/sermon/dto/status-sermon-response.dto.ts` | update/remove |

> ✅ `find-all-sermons-query.dto.ts` — канонический пример **extend/override** DTO: переопределяет `take` (string→number coercion) и `search` (trim + reject empty) поверх сгенерированной схемы. Подробнее — [`../conventions.md`](../conventions.md).

## Связанные документы

- [README.md](./README.md) — индекс модулей
- [playlist.md](./playlist.md) — плейлисты и join-таблица `playlist_sermons_sermon`
- [minio.md](./minio.md) — presigned-URL аудио, `extractFileNameFromUrl`
- [shared.md](./shared.md) — `IdParamDto`
- [../db.md](../db.md) — сущность и связи
- [../contracts/rest-api.md](../contracts/rest-api.md) — контракт `SermonController*`
- Домен sermons на фронте — репозиторий `slovo-propovedi-admin`
