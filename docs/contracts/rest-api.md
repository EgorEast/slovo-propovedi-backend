# REST API — общая спецификация и кодогенерация

> **Источник истины контракта — схемы валидации** (`src/generated/index.ts`, zod DTO). Эта страница описывает контракт и конвейер кодогенерации, но при расхождении между текстом и схемой решает **схема**. Версия спецификации в документации не фиксируется — см. `info.version` внешнего `openAPI.yaml` (репозиторий `slovo-propovedi-docs`).

Внешний контракт REST API платформы «Слово.Проповеди». **Подробный список эндпоинтов и типов — в сгенерированных файлах** (`src/generated/index.ts`); этот документ не дублирует их, а фиксирует **общую спецификацию**, **конвейер кодогенерации** и **карту реализации** эндпоинтов sermons/playlists/users в контроллерах.

**Статус:** актуально
**Слой:** contracts (внешний протокол)

## Общая спецификация

- **URL:** `https://docs.slovo-propovedi.ru/openAPI.yaml`
- **Название:** «Admin API — Слово.Проповеди» (версия — в `info.version` самого файла)
- **Где живёт:** во **внешнем swagger-репозитории** `slovo-propovedi-docs`, НЕ в этом репозитории. `/openAPI.yaml` здесь gitignored и локально отсутствует.
- **Публикация:** спецификация деплоится из `slovo-propovedi-docs` через Forgejo на тегах `v*` (`https://docs.slovo-propovedi.ru/openAPI.yaml`).
- **Потребляется:** кодогенерацией Orval (фронтенд-SDK — в репозитории `slovo-propovedi-admin`), конфиг которой хардкодит этот URL как `input`.

## Конвейер кодогенерации

### Orval (zod-схемы)

| Параметр | Значение |
|----------|----------|
| Конфиг | `orval.config.mjs` |
| Ключ проекта | `backend-schemas` |
| `input` | `https://docs.slovo-propovedi.ru/openAPI.yaml` |
| `output` | `src/generated/index.ts` |
| `client` | `zod` (`variant: 'full'`, `version: 4`) |
| `strict` | все контексты `true` (param/query/header/body/response) |
| Команда | `npm run gen:schemas` |
| Реализация | `scripts/gen-schemas.mjs` — вызывает orval программно, затем prettier по выходному файлу |

> ✅ `strict: true` для zod требует **per-context** ключей (Orval 8.23.0 молча нормализует простой `strict: true` в all-false) — см. комментарий в `orval.config.mjs`. Результат: каждая zod-схема на границе отбраковывает лишние ключи.

`gen:schemas` = `node scripts/gen-schemas.mjs`. Выходные схемы используются в `@ZodResponse()` и DTO контроллеров (`src/sermon/`, `src/playlist/`).

### При изменении спецификации

При изменении спецификации схемы регенерируются в этом репозитории (`npm run gen:schemas`); фронтенд-SDK регенерируется отдельно в своём репозитории (`slovo-propovedi-admin`). Сгенерированные файлы коммитятся вместе с кодом.

## Карта реализации эндпоинтов (sermons + playlists + users)

Ниже — эндпоинты, реализованные в контроллерах. Guards: create/reorder/update/remove/delete используют `AuthGuard` (`src/auth/guard/auth.guard.ts`); `findAll`/`findOne` у sermons/playlists публичны. **У users — все 6 эндпоинтов guarded (нет публичных чтений).** Методы контроллера — из `src/sermon/sermon.controller.ts`, `src/playlist/playlist.controller.ts`, `src/users/users.controller.ts`; методы сервиса — см. модульные документы.

### Sermons

| Эндпоинт | Guard | Метод контроллера | Метод сервиса |
|----------|-------|-------------------|----------------|
| `GET /sermons` | публичный | `SermonController.findAll` | `SermonService.findAll(take, cursor, search)` |
| `GET /sermons/:id` | публичный | `SermonController.findOne` | `SermonService.findOne` |
| `GET /sermons/:id/stream-url` | публичный | `SermonController.getStreamUrl` | `SermonService.getStreamUrl` |
| `POST /sermons` | AuthGuard | `SermonController.create` | `SermonService.create` |
| `PATCH /sermons/:id` | AuthGuard | `SermonController.update` | `SermonService.update` |
| `DELETE /sermons/:id` | AuthGuard | `SermonController.remove` | `SermonService.remove` |

> ✅ `GET /sermons` принимает query `take`, `cursor` (keyset-пагинация) и `search` (опциональный, min 1 символ, `ILIKE` по `title`/`artist`/`book`/`description`). Поиск применён в обоих путях `findAll`; без `take`/`search` отвечает полной выборкой. Подробности поиска — [`../modules/sermon.md`](../modules/sermon.md).

### Playlists

| Эндпоинт | Guard | Метод контроллера | Метод сервиса |
|----------|-------|-------------------|----------------|
| `POST /playlists` | AuthGuard | `PlaylistController.create` | `PlaylistService.create` |
| `GET /playlists` | публичный | `PlaylistController.findAll` | `PlaylistService.findAll` |
| `GET /playlists/:id` | публичный | `PlaylistController.findOne` | `PlaylistService.findOne` |
| `PATCH /playlists/:id` | AuthGuard | `PlaylistController.update` | `PlaylistService.update` (bulk-replace состава) |
| `PATCH /playlists/:id/sermons/reorder` | AuthGuard | `PlaylistController.reorderSermons` | `PlaylistService.reorderSermonsInPlaylist(id, sermonIds)` |
| `DELETE /playlists/:id` | AuthGuard | `PlaylistController.remove` | `PlaylistService.remove` |

### Users

| Эндпоинт | Guard | Метод контроллера | Метод сервиса |
|----------|-------|-------------------|----------------|
| `GET /users` | AuthGuard | `UsersController.findAll` | `UsersService.findAll` |
| `POST /users` | AuthGuard | `UsersController.create` | `UsersService.create` |
| `GET /users/:id` | AuthGuard | `UsersController.findOne` | `UsersService.findOne` |
| `PATCH /users/:id` | AuthGuard | `UsersController.update` | `UsersService.update` |
| `PATCH /users/:id/password` | AuthGuard | `UsersController.changePassword` | `UsersService.changePassword` |
| `DELETE /users/:id` | AuthGuard | `UsersController.remove` | `UsersService.remove(id, currentUserId)` |

> ✅ В отличие от sermons/playlists, **все** users-эндпоинты защищены `AuthGuard` — включая `GET /users` и `GET /users/:id` (нет публичных чтений). Схемы: `UserResponse` `{ id, name, username, email }` (**без `password`**), `CreateUserRequest` `{ name, email, username, password }`, `UpdateUserRequest` `{ name?, email?, username? }`, `ChangePasswordRequest` `{ password }`. `PATCH /users/:id/password` и `DELETE /users/:id` возвращают **`204 No Content`** (не `StatusResponseDto`). Защита self-delete/last-admin (403) — [`../modules/users.md`](../modules/users.md).

## База URL и аутентификация

- **Base URL:** `https://api.slovo-propovedi.ru` — публичный адрес развёрнутого API. Локально NestJS слушает порт `3000` (захардкожен в `src/main.ts`).
- **Аутентификация:** Bearer JWT, проверяется `AuthGuard` (`src/auth/guard/auth.guard.ts`); payload `{ id, email }`. Access/refresh flow — см. [`../modules/auth.md`](../modules/auth.md).
- **Защита на сервере:** `AuthGuard` на мутирующих эндпоинтах (см. таблицы выше) + `ZodValidationPipe` (strict) на всех границах.

## Связанные документы

- [README.md](./README.md) — индекс contracts
- [../architecture.md](../architecture.md) — bootstrap, env, runtime
- [../conventions.md](../conventions.md) — OpenAPI-first workflow, команды регенерации, DoD
- [../modules/sermon.md](../modules/sermon.md) — домен проповедей
- [../modules/playlist.md](../modules/playlist.md) — домен плейлистов
- Технический долг по кодогенерации и внешней спецификации — фиксируй отдельно (например, в `docs/debt.md`)
