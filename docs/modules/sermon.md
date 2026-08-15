# Модуль `sermon` — проповеди

Проповедь — основная единица контента. Модуль: CRUD, поиск (полнотекстовый, независимый от порядка слов, с ранжированием по релевантности: PostgreSQL FTS `russian` + `ts_rank`), keyset-пагинация (`take`/`cursor`), presigned-URL аудио, синхронизация членства в плейлистах.

**Слой:** backend (module `sermon`)
**Статус:** актуально

## Эндпоинты

| Метод / путь | Guard | Query/Body/Param | DTO ответа | Метод сервиса |
|---------------|-------|------------------|------------|----------------|
| `POST /sermons` | ✅ `AuthGuard` + `RolesGuard` (admin, moderator) | body `CreateSermonDto` | `SermonResponseDto` | `create` |
| `GET /sermons` | публичный | query `FindAllSermonsQueryDto` | `AllSermonsResponseDto` | `findAll(take, cursor, search)` |
| `GET /sermons/distinct-values` | публичный | — | `DistinctValuesResponseDto` | `getDistinctValues` |
| `GET /sermons/:id` | публичный | param `IdParamDto` | `SermonResponseDto` | `findOne` |
| `GET /sermons/:id/stream-url` | публичный | param `IdParamDto` | `StreamUrlResponseDto` | `getStreamUrl` |
| `PATCH /sermons/:id` | ✅ `AuthGuard` + `RolesGuard` (admin, moderator) | param + body `UpdateSermonDto` | `StatusSermonResponseDto` | `update` |
| `DELETE /sermons/:id` | ✅ `AuthGuard` + `RolesGuard` (admin, moderator) | param `IdParamDto` | `StatusSermonResponseDto` | `remove` |

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
| `take` не задан | **полная выборка** | QueryBuilder (`getManyAndCount`): `sermon.search_vector @@ tsquery`, порядок по релевантности |
| `take` задан | **keyset (cursor)** | QueryBuilder: `take + 1` строк, порядок по релевантности + составной курсор `{ rank, id }` |

### Полнотекстовый поиск (FTS)

Поиск — **независимый от порядка слов** (AND по всем словам запроса) и **ранжированный по релевантности**, на PostgreSQL full-text search (`russian` конфигурация):

- Все поисковые поля свёрнуты в **генерируемую колонку** `sermon.search_vector` (`GENERATED ALWAYS AS ... STORED`, PostgreSQL >= 12) с весами `setweight`:
  - `A` — `title` (наивысший приоритет);
  - `B` — `artist`, `book`;
  - `D` — `description` (наинизший).
- Веса — **единый источник правды** в коде: `SEARCH_WEIGHTS` + `buildSearchVectorExpression()` (`src/sermon/sermon.service.ts`); SQL-миграция [`sql/migrations/005_sermon_search_tsvector.sql`](../../sql/migrations/005_sermon_search_tsvector.sql) и `sql/bootstrap.sql` используют то же выражение (дрейф ловится спеками).
- Ранжирование: `ts_rank('{0.1,0.2,0.4,1.0}'::float4[], sermon.search_vector, tsquery)` — массив весов в порядке **D, C, B, A** (description 0.1, artist/book 0.4, title 1.0; неиспользуемый C — дефолт 0.2).

### Стратегия tsquery: `to_tsquery` + префикс `:*`

Выбрана **`to_tsquery('russian', ...)` с `:*` на каждом токене**, а не `websearch_to_tsquery` (проверено на throwaway-БД, см. ниже):

| Критерий | `websearch_to_tsquery` | `to_tsquery` + `:*` |
|----------|------------------------|----------------------|
| Многословный AND | ✅ | ✅ |
| Независимость от порядка слов | ✅ | ✅ |
| Префикс частичного слова (`благода` → `благодать`) | ❌ | ✅ |
| Русский стеммер: `Иван`→`ива`, `Иванов`→`иван` | ❌ (`иван` не находит `Иванов`) | ✅ (`ива:*` находит оба) |

Русский стеммер асимметричен (`Иван` → лексема `ива`, `Иванов` → `иван`): `websearch_to_tsquery('russian', 'благодать иван')` = `'благода' & 'ива'` — точное совпадение лексем не находит `Иванов`. Префикс `:*` компенсирует асимметрию.

### Санитизация на границе (parse, don't validate)

`buildSearchTsQuery(search)` — **чистая функция на границе**, одна для обоих путей:

```ts
const buildSearchTsQuery = (search: string): string => {
  const tokens = search.match(/[\p{L}\p{N}]+/gu) ?? [];
  if (!tokens.length) throw new BadRequestException('search must contain at least one word character');
  return tokens.map((token) => `${token}:*`).join(' & ');
};
```

- Оставляет только «словные» символы (буквы/цифры, включая кириллицу) — синтаксис tsquery (`&`, `|`, `!`, `(`, `)`, `:`, `*`, `<`, `>`) в SQL не проходит.
- Каждый токен получает `:*` (частичное слово) и соединяется `&` (AND, порядок слов не важен).
- Пустой результат после санитизации (`"&&&"`) → `BadRequestException` (fail fast).

### Условие и ранжирование (общие для обоих путей)

`tsquery` строится **один раз на запрос** и биндится параметром `:tsquery`; выражение оборачивается в `to_tsquery('russian', ...)`. Стеммер применяется и к запросу, и к вектору — **сырой текст в `@@` не стеммится** и не находит совпадений:

```ts
TS_SEARCH_CONDITION = "sermon.search_vector @@ to_tsquery('russian', :tsquery)";
RANK_EXPRESSION = "ts_rank('{0.1,0.2,0.4,1.0}'::float4[], sermon.search_vector, to_tsquery('russian', :tsquery))";
```

### Keyset-пагинация

- **Без search** — поведение не меняется: `ORDER BY sermon.id DESC`, курсор `sermon.id < :cursor`, `nextCursor` = `id` (регрессия не поисковой пагинации не допускается).
- **С search** — порядок `(rank DESC, sermon.id DESC)`, поэтому **голый id-курсор неверен**: курсор составной `{ rank, id }`, непрозрачный для клиента (base64 JSON). Пагинация — row-value сравнением:

  ```sql
  (ts_rank('{0.1,0.2,0.4,1.0}'::float4[], sermon.search_vector, to_tsquery('russian', :tsquery)), sermon.id) < (:rank::float4, :id)
  ```

  Ранг в БД — `float4`; JS-число (`float8`) приводится обратно `::float4`, иначе float-округление при равных рангах пропускает/дублирует строки.
- Старые курсоры (голый uuid) **инвалидированы** — `decodeCompositeCursor` бросает `BadRequestException('invalid or stale cursor')`.
- `take + 1` строк; лишняя строка решает, есть ли следующая страница. Ранг последней строки берётся из raw-строк запроса (`addSelect(RANK_EXPRESSION, 'rank')` + `getRawAndEntities`).

### Ограничение TypeORM (почему ранк — через select-алиас)

`getMany`/`getRawAndEntities` с `take` + join-ами пагинирует двумя запросами и **не умеет** сложное выражение в `ORDER BY` (разбирает строку как `alias.column` и падает на `'{0.1,...`). Поэтому ранг выносится в **select-алиас**: `addSelect(RANK_EXPRESSION, 'rank')` + `orderBy('rank', 'DESC')` — алиас переживает подзапрос пагинации, а `rank` в сущность не попадает (unmapped).

### Полная выборка

Полная выборка (без `take`) переведена с `findAndCount` на QueryBuilder + `getManyAndCount`, чтобы **оба пути** использовали одно FTS-условие и ранжирование. Ответ: `{ sermons, count, nextCursor: null }` — форма не изменилась.

> ✅ `findAll` без `take`/`search` отдаёт **всю** выборку (backward-compat, используется админкой при первичной загрузке). Поиск применён в **обоих** путях.

## `getDistinctValues` — уникальные проповедники и книги (автодополнение)

Отдаёт два **независимых** списка ранее использованных значений — `{ artists, books }` — для автодополнения полей `artist`/`book` в формах админки.

- **Два отдельных запроса**, а не `DISTINCT` по двум колонкам вместе: `SELECT DISTINCT (artist, book)` вернул бы пары «проповедник + книга», а списки должны быть независимыми.
- Каждый запрос фильтрует на уровне SQL: `IS NOT NULL` и `trim(...) <> ''` — NULL и пустые/пробельные значения не попадают в ответ.
- Порядок — **алфавитный**, задан `ORDER BY ... ASC` в SQL (детерминированный).
- Маршрут **публичный** (как `findAll`); объявлен **до** `@Get(':id')` — иначе статический сегмент `distinct-values` был бы перехвачен параметром `:id`.

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
| `src/sermon/dto/find-all-sermons-query.dto.ts` | extends query + `.extend({ take: z.coerce.number().int().min(1).max(100).optional(), search: z.string().trim().min(1).optional(), cursor: z.string().min(1).optional() })` + `.superRefine(...)` |
| `src/sermon/dto/sermon-response.dto.ts` | create/findOne |
| `src/sermon/dto/all-sermons-response.dto.ts` | findAll |
| `src/sermon/dto/distinct-values-response.dto.ts` | distinct-values |
| `src/sermon/dto/stream-url-response.dto.ts` | stream-url |
| `src/sermon/dto/status-sermon-response.dto.ts` | update/remove |

> ✅ `find-all-sermons-query.dto.ts` — канонический пример **extend/override** DTO: переопределяет `take` (string→number coercion), `search` (trim + reject empty) и `cursor` (сгенерированный `zod.uuid()` → непрозрачная строка: search-страницы несут составной курсор, non-search — прежний uuid-id). `superRefine` возвращает прежний fail-fast для мусорного курсора на non-search-странице. Подробнее — [`../conventions.md`](../conventions.md).

## Связанные документы

- [README.md](./README.md) — индекс модулей
- [playlist.md](./playlist.md) — плейлисты и join-таблица `playlist_sermons_sermon`
- [minio.md](./minio.md) — presigned-URL аудио, `extractFileNameFromUrl`
- [shared.md](./shared.md) — `IdParamDto`
- [../db.md](../db.md) — сущность и связи
- [../contracts/rest-api.md](../contracts/rest-api.md) — контракт `SermonController*`
- Домен sermons на фронте — репозиторий `slovo-propovedi-admin`
