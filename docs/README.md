# docs — Документация backend-репозитория (NestJS API)

Здесь — документация backend-репозитория «Слово.Проповеди» (`slovo-propovedi-backend`): **NestJS 10 + TypeORM + PostgreSQL + MinIO**. Она живёт co-located с кодом (в `docs/`). Здесь фиксируется «почему» и «где что живёт»: bootstrap, валидация, схемы БД, соглашения и каждый модуль. Машино-проверяемые правила (eslint, prettier, Jest, строгий TypeScript) не дублируются — они настроены и обоснованы в [`architecture.md`](./architecture.md).

**Слой:** backend (NestJS API)
**Статус:** актуально

## Как устроен раздел

| Файл | Назначение |
|------|------------|
| [`architecture.md`](./architecture.md) | Bootstrap (`main.ts`), CORS-allow-list, глобальный Zod-пайп, Swagger UI на рантайме, env, как запускать/тестировать |
| [`conventions.md`](./conventions.md) | Соглашения: nestjs-zod, extend/override DTO, сущности, SERIALIZABLE, OpenAPI-first codegen, ручные SQL-миграции |
| [`db.md`](./db.md) | TypeORM-конфиг, карта сущностей и связей, ASCII ER-диаграмма, ручные SQL-миграции |
| [`validation-pipeline.md`](./validation-pipeline.md) | Конвейер валидации: OpenAPI-first workflow, слои валидации (Zod-пайп / `@ZodResponse`), CI-freshness check |
| [`modules/README.md`](./modules/README.md) | Индекс модулей: module → endpoints → entity → doc |
| [`modules/app.md`](./modules/app.md) | Файловое хранилище: `POST/GET /files`, stream-url |
| [`modules/health.md`](./modules/health.md) | `GET /health` → `{ status: 'ok' }` |
| [`modules/auth.md`](./modules/auth.md) | login/refresh/logout/profile, JWT-токены, denylist, bcrypt, `AuthGuard` |
| [`modules/users.md`](./modules/users.md) | Сущность `user`, `UsersService`, `UsersController` (CRUD + смена пароля) |
| [`modules/sermon.md`](./modules/sermon.md) | CRUD проповедей, поиск, keyset-пагинация |
| [`modules/playlist.md`](./modules/playlist.md) | CRUD плейлистов, bulk-replace, reorder |
| [`modules/section.md`](./modules/section.md) | CRUD разделов, enums, reorder |
| [`modules/minio.md`](./modules/minio.md) | MinIO-клиенты, bucket `files`, presign, public-read |
| [`modules/shared.md`](./modules/shared.md) | Общие DTO и сгенерированный `generated/index.ts` |

> ✅ Внешний контракт REST API и конвейер кодогенерации описаны в [`contracts/rest-api.md`](./contracts/rest-api.md). Здесь — реализация backend; спецификация и сгенерированные схемы — там.

## ЖЁСТКИЕ правила для агентов

1. **Перед реализацией** фичи/фикса прочитай соответствующий документ `docs/`:
   - модуль (auth/sermon/playlist/section/...) → `modules/<модуль>.md`;
   - схема БД/сущности → `db.md`;
   - общие принципы → `architecture.md` и `conventions.md`.
   Отсутствует документ? Прочитай код и создай/дополни документ (правило 4).
2. **При изменении кода** обнови затронутые `docs/**` **в том же PR/коммите**. Изменение кода без обновления документации — неполное.
3. **Срезанный угол** (TODO, hack) → запись в отдельный документ технического долга (например, `docs/debt.md`, пока отсутствует) в том же PR.
4. **Сгенерированный код** (`src/generated/index.ts`) — **не редактировать руками**; правится только через регенерацию (`npm run gen:schemas`). Ручная правка — нарушение конвенции (см. [`conventions.md`](./conventions.md)).
5. **DDL — только через SQL-файлы** (`sql/bootstrap.sql` + ручные миграции). `synchronize: false` в TypeORM; схему через ORM-миграции не менять (см. [`db.md`](./db.md)).

## Файлы и папки

Раскладка `src/` (подробно — [`architecture.md`](./architecture.md) и [`db.md`](./db.md)):

| Путь (от корня репозитория) | Назначение |
|----------------------|------------|
| `src/main.ts` | Bootstrap: CORS, `createZodValidationPipe(strict)`, MinIO bucket, Swagger UI, порт 3000 |
| `src/app.module.ts` | Корневой модуль: регистрирует все модули + глобальный `ZodSerializerInterceptor` |
| `src/app.controller.ts` | `POST/GET /files`, `GET /files/:fileName`, `GET /files/:fileName/stream-url` |
| `src/db/typeorm.module.ts` | Подключение к PostgreSQL (конфиг, `synchronize: false`, PgBouncer) |
| `src/auth/` | `AuthGuard`, auth-контроллер, DTO |
| `src/users/` | Сущность `user`, `UsersService`, `UsersController` (CRUD + смена пароля) |
| `src/sermon/` | Проповеди: сущность, контроллер, сервис, DTO |
| `src/playlist/` | Плейлисты: сущности, контроллер, сервис, DTO |
| `src/section/` | Разделы: сущности, контроллер, сервис, DTO |
| `src/minio/` | Обёртка над объектным хранилищем (два клиента) |
| `src/health/` | `GET /health` |
| `src/shared/dto/` | Общие DTO (`IdParamDto`, `FileNameParamDto`) |
| `src/generated/index.ts` | Сгенерированные Orval zod-схемы (не редактировать) |
| `sql/bootstrap.sql` | DDL свежей БД (замена `synchronize`) |
| `sql/migrate-add-username.sql` | Ручная миграция: колонка `username` |
| `sql/migrations/001_add_positions.sql` | Ручная миграция: `position` + суррогатный PK join-таблиц |
| `orval.config.mjs` | Конфиг кодогенерации (вход — внешняя OpenAPI-спецификация) |
| `scripts/gen-schemas.mjs` | Программный запуск Orval + prettier |
| `scripts/vps-deploy.sh` | Деплой на VPS: сборка Docker-образа, рестарт systemd-юнита, пост-деплойная очистка (см. [`architecture.md`](./architecture.md)) |

## Связанные документы

- [./architecture.md](./architecture.md) — bootstrap, стек, env
- [./conventions.md](./conventions.md) — OpenAPI-first workflow, git, DoD
- [./contracts/rest-api.md](./contracts/rest-api.md) — внешний REST-контракт и конвейер кодогенерации
- [./modules/sermon.md](./modules/sermon.md) — домен sermons
- [./modules/playlist.md](./modules/playlist.md) — домен playlists
- Фронтенд-админка — отдельный репозиторий `slovo-propovedi-admin`
