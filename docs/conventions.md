# Соглашения backend: валидация, сущности, транзакции, codegen

Процессные и кодовые договорённости для backend-приложения. Здесь — «как писать код» на бэкенде: модель валидации nestjs-zod, паттерн extend/override DTO, паттерны сущностей TypeORM, изоляция SERIALIZABLE для упорядочивания, OpenAPI-first кодогенерация и ручные SQL-миграции.

**Слой:** backend (соглашения)
**Статус:** актуально

## Модель валидации: nestjs-zod

Основной механизм валидации на бэкенде — **nestjs-zod**. Два глобальных механизма (см. [`architecture.md`](./architecture.md)):

| Слой | Механизм | Что делает |
|------|----------|------------|
| Вход (body/query/param) | `ZodValidationPipe` (strict, `main.ts`) | валидирует каждый параметр роута по его Zod-DTO |
| Выход (ответ) | `ZodSerializerInterceptor` + `@ZodResponse({ type: Dto })` | валидирует исходящий ответ по zod-схеме из `generated` |

Каждый request-DTO — класс, наследующий `createZodDto(<схема>)`. Схемы, как правило, **сгенерированы** (Orval из OpenAPI) и лежат в `src/generated/index.ts`.

```ts
// src/sermon/dto/create-sermon.dto.ts
import { createZodDto } from 'nestjs-zod';
import { SermonControllerCreateBody } from '../../generated';

export class CreateSermonDto extends createZodDto(SermonControllerCreateBody) {}
```

> ✅ Сгенерированные схемы используют `zod.strictObject` (лишние ключи отбраковываются), `zod.uuid()`, enums, `.default()` для boolean в ответах и union-типы для `verse`. `strictSchemaDeclaration: true` требует, чтобы **каждый** параметр роута был Zod-DTO — иначе пайп бросает ошибку.

### Исключение: Multer upload

`src/app/dto/file-upload.dto.ts` использует `createZodDto(z.any())` — пермиссивный passthrough для `Express.Multer.File` (это TS-интерфейс, стирающийся в `Object`; аннотация Zod-DTO нужна только чтобы удовлетворить strict-пайп). Наличие и тип файла проверяются в контроллере.

### Legacy: class-validator

`class-validator` остался **только** на сущности `User` (`src/users/entities/user.entity.ts`: `@IsNotEmpty`, `@IsEmail`, `@IsString`) — для HTTP-валидации не используется. См. [`modules/users.md`](./modules/users.md).

## Паттерн extend/override DTO

Сгенерированные схемы «из коробки» подходят не всегда: query-параметры приходят строками, а поиск надо нормализовать. Паттерн — взять сгенерированную схему и `.extend(...)`, переопределив нужные поля.

```ts
// src/sermon/dto/find-all-sermons-query.dto.ts
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { SermonControllerFindAllQueryParams } from '../../generated';

const FindAllSermonsQuerySchema = SermonControllerFindAllQueryParams.extend({
  take: z.coerce.number().int().min(1).max(100).optional(), // string → number
  search: z.string().trim().min(1).optional(),              // trim + reject empty
});

export class FindAllSermonsQueryDto extends createZodDto(FindAllSermonsQuerySchema) {}
```

- `take` коэрсится `z.coerce.number()` (query-строка → число) и ограничивается `1..100`;
- `search` нормализуется `trim()` и отклоняется, если после обрезки пуст;
- `cursor` уже `zod.uuid()`, принимает строки как есть — переопределять не нужно.

> ✅ Правило: **не переписывать** сгенерированные схемы руками — только `.extend(...)`/override поверх них. Так контракт остаётся в одной точке (`generated`), а ручные правки — локальные уточнения на границе.

## Паттерны сущностей TypeORM

| Правило | Пример |
|---------|--------|
| Таблица через `@Entity('<name>')` — имя таблицы = название сущности | `@Entity('sermon')` → `SermonEntity` |
| `@PrimaryGeneratedColumn('uuid')` `id: string` — uuid-PK у всех сущностей | `sermon`, `playlist`, `section`, join-таблицы |
| Колонки с явным именем через `@Column({ name: '...' })` | `text-file-url`, `audio-url`, `items-size` |
| Nullable-поля — через `nullable: true` | `book`, `chapter`, `verse` |
| Join-таблицы — **явные join-сущности** с суррогатным `id`-PK + UNIQUE на FK-паре + `position` | `PlaylistSermonJoinEntity`, `SectionPlaylistJoinEntity` |
| Отношения — `@OneToMany`/`@ManyToOne` с `cascade: true` и `onDelete: 'CASCADE'` | см. [`db.md`](./db.md) |

> ⚠️ Join-таблицы имеют **суррогатный `id`-PK**, а не составной `(fk1, fk2)`: уникальность пары сохранена отдельным UNIQUE-констрейнтом. Это сделано, чтобы нести колонку `position` для drag-and-drop. История перехода — миграция `sql/migrations/001_add_positions.sql`.

## SERIALIZABLE-транзакции для упорядочивания

Везде, где важен корректный `position` при конкурентных вставках, используется изоляция `SERIALIZABLE`. Два шаблона:

### 1. Максимальный `position + 1` (append)

При добавлении (проповедь в плейлист, плейлист в раздел, создание раздела) вычисляется `max(position)` внутри SERIALIZABLE-транзакции, чтобы два конкурентных append не прочитали один и тот же max:

```ts
await this.dataSource.transaction('SERIALIZABLE', async (manager) => {
  const joinRepository = manager.getRepository(PlaylistSermonJoinEntity);
  for (const playlistId of playlistIds) {
    const maxPosition = await joinRepository.maximum('position', { playlistId });
    await joinRepository.save(joinRepository.create({
      playlistId,
      sermonId: sermon.id,
      position: (maxPosition ?? -1) + 1,
    }));
  }
});
```

### 2. Одиночный `CASE id` UPDATE (reorder)

Drag-and-drop персистит полный упорядоченный набор; позиции обновляются **одним** UPDATE с выражением `CASE id ... END` вместо N отдельных запросов:

```ts
const positionCase = ids
  .map((id, index) => `WHEN '${id}' THEN ${index}`)
  .join(' ');
await repository.createQueryBuilder()
  .update(SectionEntity)
  .set({ position: () => `CASE id ${positionCase} END` })
  .where('id IN (:...ids)', { ids })
  .execute();
```

> ✅ Безопасность интерполяции: `id` и `join.id` — uuid, провалидированные Zod-DTO (`zod.uuid()`), поэтому интерполяция в CASE безопасна. Reorder требует **полный in-scope набор** (иначе позиции «схлопнутся») и отклоняет дубликаты.

## OpenAPI-first codegen

Внешняя спецификация (`https://docs.slovo-propovedi.ru/openAPI.yaml`) — **вход кодогенерации**: backend генерирует из неё zod-схемы через Orval. **Источник истины контракта — сгенерированные схемы валидации** (`src/generated/index.ts`): prose описывает, схема решает; при расхождении между текстом и схемой приоритет у схемы. Версию спецификации в доках не фиксируют — актуальная версия в `info.version` внешнего `openAPI.yaml`.

| Параметр | Значение |
|----------|----------|
| Конфиг | `orval.config.mjs` |
| Вход | `https://docs.slovo-propovedi.ru/openAPI.yaml` |
| Выход | `src/generated/index.ts` (single-file, ~1650 строк) |
| Клиент | zod v4 (`variant: 'full'`) |
| `strict` | все контексты `true` (param/query/header/body/response) |
| Команда | `npm run gen:schemas` |
| Реализация | `scripts/gen-schemas.mjs` — вызывает orval программно (обход бага Node 22 / orval CLI), затем prettier по выходному файлу |

Правила:

- `src/generated/index.ts` — **не редактировать руками**; только `npm run gen:schemas`.
- При изменении спецификации регенерируются **обе** стороны: здесь (backend, Orval) — в этом репозитории; фронтенд (@hey-api) — отдельно в репозитории `slovo-propovedi-admin`, в одном PR/одним коммитом с кодом.
- Подробности конвейера и карта эндпоинтов — в [`contracts/rest-api.md`](./contracts/rest-api.md).

## Ручные SQL-миграции

`typeorm` работает с `synchronize: false` (причина — PgBouncer в transaction mode, см. [`db.md`](./db.md)), поэтому DDL выполняется **вручную** через SQL-файлы, без TypeORM migration runner.

| Файл | Назначение | Когда |
|------|------------|-------|
| `sql/bootstrap.sql` | полная схема свежей БД | один раз на новую БД (superuser/owner) |
| `sql/migrate-add-username.sql` | колонка `username` на `user` | вручную на существующие установки |
| `sql/migrations/001_add_positions.sql` | колонки `position` + суррогатный PK join-таблиц | вручную на существующие установки |

Команда применения — как DB-owner:

```bash
psql -h <host> -U <user> -d <db> -f sql/migrate-add-username.sql
psql -h <host> -U <user> -d <db> -f sql/migrations/001_add_positions.sql
```

> ✅ Все ручные миграции **идемпотентны** (`ADD COLUMN IF NOT EXISTS`, `DROP CONSTRAINT IF EXISTS`, guard'ы по `WHERE position = 0`), безопасны к повторному запуску. Новую схему-изменение следует оформлять как идемпотентный SQL-файл в `sql/` и отражать в `bootstrap.sql`.

## Связанные документы

- [README.md](./README.md) — индекс документации backend-репозитория
- [architecture.md](./architecture.md) — bootstrap, глобальные механизмы, env
- [db.md](./db.md) — TypeORM-конфиг, карта сущностей, SQL-миграции
- [modules/sermon.md](./modules/sermon.md) — пример extend/override DTO и поиска
- [contracts/rest-api.md](./contracts/rest-api.md) — конвейер кодогенерации
