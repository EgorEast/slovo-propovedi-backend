# Индекс модулей backend

Карта модулей NestJS-приложения `src/`. По одному документу на модуль (плюс `shared` и `generated`). Каждый документ фиксирует «почему» и «где что живёт»; полный контракт эндпоинтов и типов — в сгенерированных файлах и [`../contracts/rest-api.md`](../contracts/rest-api.md).

**Слой:** backend (modules)
**Статус:** актуально

## Модули

| Модуль | Эндпоинты | Сущность | Документ |
|--------|-----------|----------|----------|
| `app` (файлы) | `POST /files`, `GET /files`, `GET /files/:fileName`, `GET /files/:fileName/stream-url` | — (MinIO) | [`app.md`](./app.md) |
| `health` | `GET /health` | — | [`health.md`](./health.md) |
| `auth` | `POST /auth/login`, `POST /auth/refresh`, `GET /auth/profile` | — (JWT) | [`auth.md`](./auth.md) |
| `users` | `POST /users`, `GET /users`, `GET /users/:id`, `PATCH /users/:id`, `PATCH /users/:id/password`, `DELETE /users/:id` | `User` (`user`) | [`users.md`](./users.md) |
| `sermon` | `POST /sermons`, `GET /sermons`, `GET /sermons/:id`, `GET /sermons/:id/stream-url`, `PATCH /sermons/:id`, `DELETE /sermons/:id` | `SermonEntity` (`sermon`) | [`sermon.md`](./sermon.md) |
| `playlist` | `POST /playlists`, `GET /playlists`, `GET /playlists/:id`, `PATCH /playlists/:id`, `PATCH /playlists/:id/sermons/reorder`, `DELETE /playlists/:id` | `PlaylistEntity` (`playlist`) + `PlaylistSermonJoinEntity` | [`playlist.md`](./playlist.md) |
| `section` | `POST /section`, `GET /section`, `GET /section/:id`, `PATCH /section/reorder`, `PATCH /section/:id/playlists/reorder`, `PATCH /section/:id`, `DELETE /section/:id` | `SectionEntity` (`section`) + `SectionPlaylistJoinEntity` | [`section.md`](./section.md) |
| `minio` | (не HTTP) | — | [`minio.md`](./minio.md) |
| `shared` | (не HTTP) | — | [`shared.md`](./shared.md) |

> ✅ Модуль `app` (корневой контроллер) — файловое хранилище; `minio` — обёртка над MinIO, которую используют `app`, `sermon` и bootstrap. Модуль `users` — полноценный CRUD аккаунтов с ролями (`UsersController`, 6 эндпоинтов, все admin-only) + сервис для `auth`.

## Авторизация (кратко)

Роли: `admin` / `moderator` / `user` (`UserRole`, живут в JWT-payload `{ id, email, role }` и в БД). `AuthGuard` парсит payload zod-схемой (legacy-токены без роли → 401 → refresh); `RolesGuard` fail-closed по `@Roles(...)`.

- **Публичные чтения** (без аутентификации, любая роль): `GET /sermons`, `/sermons/:id`, `/sermons/:id/stream-url`, `GET /playlists`, `/playlists/:id`, `GET /section`, `/section/:id`, `/files/:fileName*`, `/health`, `/auth/login`, `/auth/refresh`.
- **Guarded (`AuthGuard`):** `GET /auth/profile` (любой аутентифицированный, включая `user`).
- **Guarded (`AuthGuard` + `RolesGuard`):**
  - **admin-only:** все `/users*`;
  - **admin/moderator:** все write-эндпоинты (`POST/PATCH/DELETE` sermons/sections/playlists), `POST /files`, `GET /files` (инвентарь хранилища).

Полная карта — в [`auth.md`](./auth.md), [`users.md`](./users.md) и [`../contracts/rest-api.md`](../contracts/rest-api.md).

## Структура типичного модуля

```
src/<module>/
├── <module>.module.ts      # декларация модуля (imports/controllers/providers/exports)
├── <module>.controller.ts  # роуты + @ZodResponse + @UseGuards
├── <module>.service.ts     # бизнес-логика + транзакции + normalize
├── entities/               # TypeORM-сущности
├── dto/                    # createZodDto(DTO) — тело/query/ответы
└── interfaces/ или interfacies/  # TS-интерфейсы/типы ответов (см. section.md про опечатку)
```

## Связанные документы

- [../README.md](../README.md) — индекс документации backend-репозитория
- [../architecture.md](../architecture.md) — bootstrap, глобальные механизмы
- [../conventions.md](../conventions.md) — DTO, сущности, транзакции
- [../db.md](../db.md) — TypeORM-конфиг и карта сущностей
- [../contracts/rest-api.md](../contracts/rest-api.md) — полный контракт эндпоинтов
