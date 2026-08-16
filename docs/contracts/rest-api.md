# REST API — общая спецификация и кодогенерация

> **Источник истины контракта — схемы валидации** (`src/generated/index.ts`, zod DTO). Эта страница описывает контракт и конвейер кодогенерации, но при расхождении между текстом и схемой решает **схема**. Версия спецификации в документации не фиксируется — см. `info.version` внешнего `openAPI.yaml` (репозиторий `slovo-propovedi-docs`).

Внешний контракт REST API платформы «Слово.Проповеди». **Подробный список эндпоинтов и типов — в сгенерированных файлах** (`src/generated/index.ts`); этот документ не дублирует их, а фиксирует **общую спецификацию**, **конвейер кодогенерации** и **карту реализации** эндпоинтов sermons/playlists/users в контроллерах.

**Статус:** актуально
**Слой:** contracts (внешний протокол)

## Общая спецификация

- **URL:** `https://docs.slovo-propovedi.ru/openAPI.yaml`
- **Название:** «API — Слово.Проповеди» (версия — в `info.version` самого файла)
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

## Карта реализации эндпоинтов (sermons + playlists + users + files)

Ниже — эндпоинты, реализованные в контроллерах. **Чтения контента публичны** (без аутентификации — доступны и роли `user`, и анонимам): `findAll`/`findOne` у sermons/sections/playlists и файловые GET-выдачи по имени (`GET /files/:fileName*`). **Write-эндпоинты** (`POST|PATCH|DELETE` контента) и `GET /files` (инвентарь хранилища) используют `AuthGuard` + `RolesGuard` (`src/auth/guard/roles.guard.ts`) с `@Roles(...)` — доступ только admin/moderator. **У users — все 6 эндпоинтов под `RolesGuard` (admin-only, нет публичных чтений).** Методы контроллера — из `src/sermon/sermon.controller.ts`, `src/playlist/playlist.controller.ts`, `src/section/section.controller.ts`, `src/users/users.controller.ts`, `src/app.controller.ts`; методы сервиса — см. модульные документы.

### Матрица доступа по ролям

| Роль | Публичные чтения | Контент (sermons/sections/playlists + `POST|PATCH|DELETE`) | Файлы (`POST /files`, `GET /files`) | Users (`/users*`) |
|------|------------------|--------------------------------------------------------------|--------------------------------------|-------------------|
| `admin` | ✅ | ✅ | ✅ | ✅ |
| `moderator` | ✅ | ✅ | ✅ | ❌ `403` |
| `user` | ✅ | ❌ `403` | ❌ `403` | ❌ `403` |
| аноним | ✅ | ❌ `401` (guarded) | ❌ `401` | ❌ `401` |

**Публичные маршруты** (без guard'ов): `GET /sermons`, `GET /sermons/distinct-values`, `GET /sermons/:id`, `GET /sermons/:id/stream-url`, `GET /playlists`, `GET /playlists/:id`, `GET /section`, `GET /section/:id`, `GET /files/:fileName`, `GET /files/:fileName/stream-url`, `GET /health`, `POST /auth/login`, `POST /auth/refresh`. `GET /auth/profile` и `POST /auth/logout` — `AuthGuard` без `@Roles` (любой аутентифицированный).

### Sermons

| Эндпоинт | Guard | Метод контроллера | Метод сервиса |
|----------|-------|-------------------|----------------|
| `GET /sermons` | публичный | `SermonController.findAll` | `SermonService.findAll(take, cursor, search)` |
| `GET /sermons/distinct-values` | публичный | `SermonController.getDistinctValues` | `SermonService.getDistinctValues` |
| `GET /sermons/:id` | публичный | `SermonController.findOne` | `SermonService.findOne` |
| `GET /sermons/:id/stream-url` | публичный | `SermonController.getStreamUrl` | `SermonService.getStreamUrl` |
| `POST /sermons` | `AuthGuard` + `RolesGuard` (admin, moderator) | `SermonController.create` | `SermonService.create` |
| `PATCH /sermons/:id` | `AuthGuard` + `RolesGuard` (admin, moderator) | `SermonController.update` | `SermonService.update` |
| `DELETE /sermons/:id` | `AuthGuard` + `RolesGuard` (admin, moderator) | `SermonController.remove` | `SermonService.remove` |

> ✅ `GET /sermons` принимает query `take`, `cursor` (keyset-пагинация) и `search` (опциональный, min 1 символ, полнотекстовый поиск по `title`/`artist`/`book`/`description` через tsvector FTS с `ts_rank`-ранжированием). Поиск применён в обоих путях `findAll`; без `take`/`search` отвечает полной выборкой. Подробности поиска — [`../modules/sermon.md`](../modules/sermon.md).

### Playlists

| Эндпоинт | Guard | Метод контроллера | Метод сервиса |
|----------|-------|-------------------|----------------|
| `POST /playlists` | `AuthGuard` + `RolesGuard` (admin, moderator) | `PlaylistController.create` | `PlaylistService.create` |
| `GET /playlists` | публичный | `PlaylistController.findAll` | `PlaylistService.findAll(search)` |
| `GET /playlists/:id` | публичный | `PlaylistController.findOne` | `PlaylistService.findOne` |
| `PATCH /playlists/:id` | `AuthGuard` + `RolesGuard` (admin, moderator) | `PlaylistController.update` | `PlaylistService.update` (bulk-replace состава) |
| `PATCH /playlists/:id/sermons/reorder` | `AuthGuard` + `RolesGuard` (admin, moderator) | `PlaylistController.reorderSermons` | `PlaylistService.reorderSermonsInPlaylist(id, sermonIds)` |
| `DELETE /playlists/:id` | `AuthGuard` + `RolesGuard` (admin, moderator) | `PlaylistController.remove` | `PlaylistService.remove` |

> ✅ `POST /playlists` body: `{ title, description, artwork, sermonsIds?, sectionsIds? }`. `sectionsIds?` (добавлен в v0.8.0) прикрепляет плейлист к разделам — позиция в каждом разделе = `max(position) + 1`; отсутствующий/пустой массив — no-op. Ошибки: дубликаты в `sectionsIds` → `400 Bad Request` (`Duplicate section IDs detected`); несуществующий id раздела → `404 Not Found` (`Some sections not found`). Валидация выполняется в транзакции create — при ошибке плейлист не создаётся.

> ✅ `GET /playlists` принимает query `search` (опциональный, min 1 символ, полнотекстовый поиск по `title`/`description`: PostgreSQL FTS `russian` + `ts_rank`-ранжирование, порядок `rank DESC` → `id DESC`). Без `search` отвечает полной выборкой, форма `{ playlists, count }` не меняется. Подробности — [`../modules/playlist.md`](../modules/playlist.md).

### Sections

| Эндпоинт | Guard | Метод контроллера | Метод сервиса |
|----------|-------|-------------------|----------------|
| `POST /section` | `AuthGuard` + `RolesGuard` (admin, moderator) | `SectionController.create` | `SectionService.createSectionItem` |
| `GET /section` | публичный | `SectionController.findAll` | `SectionService.findAllSectionItems` |
| `GET /section/:id` | публичный | `SectionController.findOne` | `SectionService.findOneSectionItem` |
| `PATCH /section/reorder` | `AuthGuard` + `RolesGuard` (admin, moderator) | `SectionController.reorder` | `SectionService.reorderSections(ids)` |
| `PATCH /section/:id/playlists/reorder` | `AuthGuard` + `RolesGuard` (admin, moderator) | `SectionController.reorderPlaylistsInSection` | `SectionService.reorderPlaylistsInSection(id, playlistIds)` |
| `PATCH /section/:id` | `AuthGuard` + `RolesGuard` (admin, moderator) | `SectionController.update` | `SectionService.update` |
| `DELETE /section/:id` | `AuthGuard` + `RolesGuard` (admin, moderator) | `SectionController.remove` | `SectionService.remove` |

### Files (`AppController`)

| Эндпоинт | Guard | Метод контроллера | Метод сервиса |
|----------|-------|-------------------|----------------|
| `POST /files` | `AuthGuard` + `RolesGuard` (admin, moderator) | `AppController.uploadFile` | `MinioService.uploadFile` |
| `GET /files` | `AuthGuard` + `RolesGuard` (admin, moderator) | `AppController.listFiles` | `MinioService.listImages` (cover-reuse) |
| `GET /files/:fileName` | публичный | `AppController.getFile` | `MinioService.getFileUrl` (deprecated) |
| `GET /files/:fileName/stream-url` | публичный | `AppController.getStreamUrl` | `MinioService.getPresignedFileUrl` |

### Auth

| Эндпоинт | Guard | Метод контроллера | Метод сервиса |
|----------|-------|-------------------|----------------|
| `POST /auth/login` | публичный | `AuthController.signIn` | `AuthService.signIn(username, password)` |
| `POST /auth/refresh` | публичный | `AuthController.refresh` | `AuthService.refreshTokens(refreshToken)` |
| `POST /auth/logout` | `AuthGuard` (без `@Roles`) | `AuthController.logout` | `AuthService.logout(refreshToken)` |
| `GET /auth/profile` | `AuthGuard` (без `@Roles`) | `AuthController.getProfile` | `AuthService.getProfile(req.user.id)` |

> ✅ `POST /auth/logout` доступен **любой аутентифицированной роли** (`admin` / `moderator` / `user`) — без `RolesGuard`. Отзывает refresh-токен (denylist, sha256-хэш в `revoked_refresh_token`); повторный logout с тем же токеном — тоже `204`. `POST /auth/refresh` **ротирует** пару: предъявленный refresh-токен отзывается в том же запросе (один живой refresh-токен на цепочку; повторный refresh со старым токеном → `401`). Access-токен остаётся технически валидным до истечения (≤ 30 мин). Детали — [`../modules/auth.md`](../modules/auth.md).

### Users

| Эндпоинт | Guard | Метод контроллера | Метод сервиса |
|----------|-------|-------------------|----------------|
| `GET /users` | `AuthGuard` + `RolesGuard` (admin) | `UsersController.findAll` | `UsersService.findAll` |
| `POST /users` | `AuthGuard` + `RolesGuard` (admin) | `UsersController.create` | `UsersService.create` |
| `GET /users/:id` | `AuthGuard` + `RolesGuard` (admin) | `UsersController.findOne` | `UsersService.findOne` |
| `PATCH /users/:id` | `AuthGuard` + `RolesGuard` (admin) | `UsersController.update` | `UsersService.update(id, dto, currentUserId)` |
| `PATCH /users/:id/password` | `AuthGuard` + `RolesGuard` (admin) | `UsersController.changePassword` | `UsersService.changePassword` |
| `DELETE /users/:id` | `AuthGuard` + `RolesGuard` (admin) | `UsersController.remove` | `UsersService.remove(id, currentUserId)` |

> ✅ В отличие от sermons/playlists, **все** users-эндпоинты защищены `AuthGuard` + `RolesGuard` с `@Roles(UserRole.Admin)` — включая `GET /users` и `GET /users/:id` (нет публичных чтений). Схемы: `UserResponse` `{ id, name, username, email, role }` (**без `password`**), `CreateUserRequest` `{ name, email, username, password, role? }`, `UpdateUserRequest` `{ name?, email?, username?, role? }`, `ChangePasswordRequest` `{ password }`. Роль: `zod.enum(['admin','moderator','user'])` — обязательна в ответах, опциональна в create/update (дефолт `'user'`). `PATCH /users/:id/password` и `DELETE /users/:id` возвращают **`204 No Content`** (не `StatusResponseDto`). Защита self-delete/last-admin/self-role-change (403) — [`../modules/users.md`](../modules/users.md).

## База URL и аутентификация

- **Base URL:** `https://api.slovo-propovedi.ru` — публичный адрес развёрнутого API. Локально NestJS слушает порт `3000` (захардкожен в `src/main.ts`).
- **Аутентификация:** Bearer JWT, проверяется `AuthGuard` (`src/auth/guard/auth.guard.ts`); payload `{ id, email, role }` (zod-парсинг на входе, legacy-токены без `role` → `401` → refresh). Авторизация по ролям — `RolesGuard` (`@Roles`, fail-closed). Access/refresh flow — см. [`../modules/auth.md`](../modules/auth.md).
- **Защита на сервере:** `AuthGuard` + `RolesGuard` на мутирующих эндпоинтах (см. таблицы выше) + `ZodValidationPipe` (strict) на всех границах.

## Связанные документы

- [README.md](./README.md) — индекс contracts
- [../architecture.md](../architecture.md) — bootstrap, env, runtime
- [../conventions.md](../conventions.md) — OpenAPI-first workflow, команды регенерации, DoD
- [../modules/sermon.md](../modules/sermon.md) — домен проповедей
- [../modules/playlist.md](../modules/playlist.md) — домен плейлистов
- Технический долг по кодогенерации и внешней спецификации — фиксируй отдельно (например, в `docs/debt.md`)
