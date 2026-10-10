# Модуль `feature-flags` — удалённые фича-флаги с пер-пользовательскими исключениями

Удалённые переключатели функциональности. Глобальный дефолт каждого флага живёт в таблице `feature_flag`, а пер-пользовательские исключения (`grant` / `deny`) — в `feature_flag_override`. Эффективное значение для пользователя вычисляется на чтение (глобальный дефолт + override), поэтому клиенту достаточно одного `GET /feature-flags/me`.

**Слой:** backend (module `feature-flags`)
**Статус:** актуально

> ✅ Флаги `read` и `study` сидируются миграцией `009_feature_flags.sql` (и `bootstrap.sql`) в состоянии `enabled = false` — мобильные табы «Читать»/«Учиться» включаются админом осознанно.

## Эндпоинты

`@Controller('feature-flags')` (`src/feature-flags/feature-flags.controller.ts`).

| Метод / путь | Guard | Body | DTO ответа | Метод сервиса |
|---------------|-------|------|------------|----------------|
| `GET /feature-flags/me` | ✅ `AuthGuard` (любой аутентифицированный) | — | `EffectiveFeatureFlagListResponseDto` (`{ flags: [{ key, enabled }] }`) | `getEffectiveForUser(userId, userRole)` |
| `GET /feature-flags` | ✅ `AuthGuard` + `RolesGuard` (admin) | — | `FeatureFlagListResponseDto` (`{ flags: FeatureFlag[] }`) | `findAll()` |
| `POST /feature-flags` | ✅ `AuthGuard` + `RolesGuard` (admin) | `CreateFeatureFlagDto` (`{ key, title }`) | `FeatureFlagResponseDto` | `create(dto)` |
| `PATCH /feature-flags/:id` | ✅ `AuthGuard` + `RolesGuard` (admin) | `UpdateFeatureFlagDto` (`{ key?, title?, enabled? }`) | `FeatureFlagResponseDto` | `update(id, dto)` |
| `DELETE /feature-flags/:id` | ✅ `AuthGuard` + `RolesGuard` (admin) | — | `204 No Content` | `remove(id)` |
| `PUT /feature-flags/:id/overrides/:userId` | ✅ `AuthGuard` + `RolesGuard` (admin) | `SetFeatureFlagOverrideDto` (`{ value: 'grant' \| 'deny' }`) | `204 No Content` | `setOverride(id, userId, value)` |
| `DELETE /feature-flags/:id/overrides/:userId` | ✅ `AuthGuard` + `RolesGuard` (admin) | — | `204 No Content` | `deleteOverride(id, userId)` |

> ✅ `GET /feature-flags/me` — **единственный** роут под `AuthGuard` без `@Roles`: эффективные значения нужны и обычной роли `user`. Всё управление флагами (`GET`-список, create/update/delete, override-ы) — **admin-only** (moderator доступа не имеет).
>
> ⚠️ Параметры маршрута — zod-DTO: `:id` → `IdParamDto`, `:id` + `:userId` → `FeatureFlagOverrideParamsDto` (оба uuid). Требование `strictSchemaDeclaration: true` (см. [`../validation-pipeline.md`](../validation-pipeline.md)).

## Сущности

### `FeatureFlag` — таблица `feature_flag` (`src/feature-flags/entities/feature-flag.entity.ts`)

| Поле | Колонка | Тип | Ограничения |
|------|---------|-----|-------------|
| `id` | `id` | uuid | PK |
| `key` | `key` | varchar | **UNIQUE** (`UQ_feature_flag_key`), `^[a-z][a-z0-9-]*$` |
| `title` | `title` | varchar | NOT NULL |
| `enabled` | `enabled` | boolean | NOT NULL, default `false` |
| `createdAt` | `created_at` | timestamptz | NOT NULL, default `now()` |
| `updatedAt` | `updated_at` | timestamptz | NOT NULL, default `now()` (автообновление `@UpdateDateColumn`) |

### `FeatureFlagOverride` — таблица `feature_flag_override` (`src/feature-flags/entities/feature-flag-override.entity.ts`)

| Поле | Колонка | Тип | Ограничения |
|------|---------|-----|-------------|
| `id` | `id` | uuid | PK |
| `flagId` | `flag_id` | uuid | FK → `feature_flag`(id), CASCADE; UNIQUE(`flag_id`, `user_id`) |
| `userId` | `user_id` | uuid | FK → `user`(id), CASCADE |
| `value` | `value` | varchar | NOT NULL, `'grant' \| 'deny'` (TS-union `FeatureFlagOverrideValue`) |

> ✅ На пару `(flag, user)` — не более одной строки (композитный UNIQUE `UQ_feature_flag_override_pair`). Отсутствие строки и наличие строки — два возможных состояния; `setOverride` — upsert, поэтому повторный вызов обновляет значение, а не плодит дубли.

## `FeatureFlagsService` (`src/feature-flags/feature-flags.service.ts`)

| Метод | Назначение |
|-------|------------|
| `findAll()` | все флаги в порядке `key ASC` (ответ — `{ flags }`) |
| `create(dto)` | новый флаг с `enabled = false`; дубликат `key` → `409 Conflict` |
| `update(id, dto)` | частичное обновление; отсутствующий флаг → `404`, дубликат `key` → `409` |
| `remove(id)` | удаляет override-ы флага, затем сам флаг; отсутствующий флаг → `404` |
| `setOverride(flagId, userId, value)` | upsert исключения; нет флага/пользователя → `404` |
| `deleteOverride(flagId, userId)` | удаляет исключение (идемпотентно); нет флага/пользователя → `404` |
| `getEffectiveForUser(userId, userRole)` | эффективные значения для пользователя (см. ниже) |

### Вычисление эффективного значения (`getEffectiveForUser`)

Правило: флаг включён для пользователя, если `(enabled AND нет deny-override) OR есть grant-override`.

| `enabled` | override | эффективно |
|-----------|----------|------------|
| `true` | — | ✅ включён |
| `true` | `deny` | ❌ выключен |
| `false` | `grant` | ✅ включён |
| `false` | — | ❌ выключен |

> ✅ **`admin` и `moderator` всегда видят все флаги включёнными** (множество `PRIVILEGED_ROLES`) — override-ы для них игнорируются. Логика плоская (guard-клауза на привилегированную роль + `Map` override-ов по `flagId`), без вложенных условий.

## DTO

Все DTO — рукописные `createZodDto(z.strictObject({...}))` (`src/feature-flags/dto/`), т.к. спецификация `feature-flags` ещё не попала в сгенерированный `src/generated/index.ts`.

| Файл | Схема |
|------|-------|
| `create-feature-flag.dto.ts` | `{ key: regex ^[a-z][a-z0-9-]*$, title: string (min 1) }` |
| `update-feature-flag.dto.ts` | `{ key?, title?, enabled? }` |
| `set-feature-flag-override.dto.ts` | `{ value: 'grant' \| 'deny' }` |
| `feature-flag-override-params.dto.ts` | `{ id: uuid, userId: uuid }` |
| `feature-flag-response.dto.ts` | `FeatureFlagResponseDto` — `{ id, key, title, enabled, createdAt, updatedAt }` |
| `feature-flag-list-response.dto.ts` | `FeatureFlagListResponseDto` — `{ flags: FeatureFlagResponseDto[] }` |
| `effective-feature-flag.dto.ts` | `EffectiveFeatureFlagDto` — `{ key, enabled }` |
| `effective-feature-flag-list-response.dto.ts` | `EffectiveFeatureFlagListResponseDto` — `{ flags: EffectiveFeatureFlagDto[] }` |

## Связанные документы

- [README.md](./README.md) — индекс модулей
- [../db.md](../db.md) — таблицы `feature_flag` / `feature_flag_override`, миграция `009_feature_flags.sql`
- [../contracts/rest-api.md](../contracts/rest-api.md) — контракт `FeatureFlagsController*` и матрица ролей
- Клиентские табы «Читать»/«Учиться» — репозиторий `slovo-propovedi-mobile`
