# REST API — общая спецификация и кодогенерация

> **Источник истины контракта — схемы валидации** (`src/generated/index.ts`, zod DTO). Эта страница описывает контракт и конвейер кодогенерации, но при расхождении между текстом и схемой решает **схема**. Версия спецификации в документации не фиксируется — см. `info.version` внешнего `openAPI.yaml` (репозиторий `slovo-propovedi-docs`).

Внешний контракт REST API платформы «Слово.Проповеди». **Подробный список эндпоинтов и типов — в сгенерированных файлах** (`src/generated/index.ts` здесь и `src/lib/api/generated/` в репозитории `slovo-propovedi-admin`); этот документ не дублирует их, а фиксирует **общую спецификацию**, **конвейер кодогенерации** с обеих сторон и **карту реального использования** эндпоинтов sermons/playlists/users.

**Статус:** актуально
**Слой:** contracts (внешний протокол)

## Общая спецификация

- **URL:** `https://docs.slovo-propovedi.ru/openAPI.yaml`
- **Название:** «Admin API — Слово.Проповеди» (версия — в `info.version` самого файла)
- **Где живёт:** во **внешнем swagger-репозитории** `slovo-propovedi-docs`, НЕ в этом репозитории. `/openAPI.yaml` здесь gitignored и локально отсутствует.
- **Публикация:** спецификация деплоится из `slovo-propovedi-docs` через Forgejo на тегах `v*` (`https://docs.slovo-propovedi.ru/openAPI.yaml`).
- **Потребляется:** обеими кодогенерациями (Orval backend, @hey-api frontend), конфиги которых хардкодят этот URL как `input`.

> ⚠️ Этот же контракт документирован в братском проекте `slovo-propovedi-mobile/docs/contracts/rest-api.md`. Разница: mobile-клиент помечает большинство CRUD-эндпоинтов как **мёртвые** (нет admin-UI), тогда как здесь (backend/админка) они **живые** и реально вызываются. Одна спецификация — разные карты использования.

## Конвейер кодогенерации

### Backend — Orval (zod-схемы)

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

### Frontend — @hey-api/openapi-ts (SDK)

Генерация фронтенд-SDK происходит в отдельном репозитории `slovo-propovedi-admin` (команда `npm run gen:api`, выход `src/lib/api/generated`, пост-генерационные патчи `patch-zod-binary.mjs` / `patch-zod-strict.mjs`). Подробности и команды — в документации того репозитория.

### Обе стороны при изменении спецификации

При изменении спецификации регенерируются **обе** стороны, каждая в своём репозитории, и сгенерированные файлы коммитятся вместе с кодом: здесь (`npm run gen:schemas`) и во фронтенде (`slovo-propovedi-admin`).

> ✅ Правило: при изменении спецификации регенерируются **обе** стороны в том же PR, и коммитятся все сгенерированные файлы вместе с кодом. См. [`../conventions.md`](../conventions.md).

## Карта использования эндпоинтов (sermons + playlists + users)

Ниже — фактические эндпоинты, которые реально вызываются из админки (`slovo-propovedi-admin`). Guards: create/reorder/update/remove/delete используют `AuthGuard` (`src/auth/guard/auth.guard.ts`); `findAll`/`findOne` у sermons/playlists публичны. **У users — все 6 эндпоинтов guarded (нет публичных чтений).**

### Sermons

| Эндпоинт | Guard | Статус | Где используется |
|----------|-------|--------|------------------|
| `GET /sermons` | публичный | ✅ живой | `Sermons.svelte` (`sermonControllerFindAllOptions()` с `search`), `PlaylistForm.svelte` (поисковый пикер) |
| `GET /sermons/:id` | публичный | ✅ живой | `SermonDetail.svelte`, `SermonEdit.svelte` |
| `POST /sermons` | AuthGuard | ✅ живой | `SermonForm.svelte` (`sermonControllerCreateMutation`) |
| `PATCH /sermons/:id` | AuthGuard | ✅ живой | `SermonForm.svelte` (`sermonControllerUpdateMutation`) |
| `DELETE /sermons/:id` | AuthGuard | ✅ живой | `SermonDetail.svelte` (`sermonControllerRemoveMutation`) |
| `GET /sermons/:id/stream-url` | публичный | ❌ не используется | пресigned-URL для аудио; админка играет `audioUrl` из `SermonEntity` напрямую |

> ✅ `GET /sermons` принимает query `take`, `cursor` (keyset-пагинация) и `search` (опциональный, min 1 символ, `ILIKE` по `title`/`artist`/`book`/`description`). UI вызывает его с `search` при вводе; без `take`/`search` бэкенд отвечает полной выборкой (`findAll` без `take` в `sermon.service.ts:105-185`). Подробности поиска — [`../modules/sermon.md`](../modules/sermon.md).

### Playlists

| Эндпоинт | Guard | Статус | Где используется |
|----------|-------|--------|------------------|
| `POST /playlists` | AuthGuard | ✅ живой | `PlaylistForm.svelte` (mode create) |
| `GET /playlists` | публичный | ✅ живой | `Playlists.svelte` |
| `GET /playlists/:id` | публичный | ✅ живой | `PlaylistDetail.svelte`, `PlaylistEdit.svelte` |
| `PATCH /playlists/:id` | AuthGuard | ✅ живой | `PlaylistForm.svelte` (mode edit, body `{ title, description, artwork, sermonsIds }` → bulk replace) |
| `PATCH /playlists/:id/sermons/reorder` | AuthGuard | ✅ живой | `PlaylistDetail.svelte` (`reorderSermonsInPlaylistMutation`, требует полный in-scope набор `sermonIds`) |
| `DELETE /playlists/:id` | AuthGuard | ✅ живой | `PlaylistDetail.svelte` (`playlistControllerRemoveMutation`) |

### Users

| Эндпоинт | Guard | Статус | Где используется |
|----------|-------|--------|------------------|
| `GET /users` | AuthGuard | ✅ живой | `Users.svelte` (`usersControllerFindAllOptions()`, клиентский поиск) |
| `POST /users` | AuthGuard | ✅ живой | `UserForm.svelte` (`usersControllerCreateMutation`, mode create) |
| `GET /users/:id` | AuthGuard | ✅ живой | `UserDetail.svelte`, `UserEdit.svelte` (`usersControllerFindOneOptions`) |
| `PATCH /users/:id` | AuthGuard | ✅ живой | `UserForm.svelte` (`usersControllerUpdateMutation`, только changed-поля) |
| `PATCH /users/:id/password` | AuthGuard | ✅ живой | `UserDetail.svelte` (`usersControllerChangePasswordMutation`, body `{ password }`) |
| `DELETE /users/:id` | AuthGuard | ✅ живой | `UserDetail.svelte` (`usersControllerRemoveMutation`, кнопка скрыта для своего аккаунта) |

> ✅ В отличие от sermons/playlists, **все** users-эндпоинты защищены `AuthGuard` — включая `GET /users` и `GET /users/:id` (нет публичных чтений). Схемы: `UserResponse` `{ id, name, username, email }` (**без `password`**), `CreateUserRequest` `{ name, email, username, password }`, `UpdateUserRequest` `{ name?, email?, username? }`, `ChangePasswordRequest` `{ password }`. `PATCH /users/:id/password` и `DELETE /users/:id` возвращают **`204 No Content`** (не `StatusResponseDto`). Защита self-delete/last-admin (403) — [`../modules/users.md`](../modules/users.md).

> ℹ️ Названия `.svelte`-компонентов в таблицах относятся к репозиторию `slovo-propovedi-admin` (фронтенд-админка).

## База URL и аутентификация

- **Base URL:** `https://api.slovo-propovedi.ru` — константа `API_BASE_URL` в `src/lib/api/client.ts` фронтенд-репозитория (`VITE_API_BASE` переопределяет; в локальной разработке `/api` → Vite-прокси на `localhost:3000`).
- **Аутентификация:** Bearer JWT. Фронтенд хранит пару токенов в `localStorage` (ключ `slovo_admin_tokens`), интерцептор добавляет `Authorization: Bearer <accessToken>` к каждому запросу, а на `401` (кроме `POST /auth/login` и `POST /auth/refresh`) выполняет `authControllerRefresh`, повторяет запрос один раз и только потом объявляет сессию истёкшей (`onAuthExpired`).
- **Защита на сервере:** `AuthGuard` на мутирующих эндпоинтах (см. таблицы выше) + `ZodValidationPipe` (strict) на всех границах.

## Связанные документы

- [README.md](./README.md) — индекс contracts
- [../architecture.md](../architecture.md) — bootstrap, env, runtime
- [../conventions.md](../conventions.md) — OpenAPI-first workflow, команды регенерации, DoD
- [../modules/sermon.md](../modules/sermon.md) — домен проповедей
- [../modules/playlist.md](../modules/playlist.md) — домен плейлистов
- Технический долг по кодогенерации и внешней спецификации — фиксируй отдельно (например, в `docs/debt.md`)
