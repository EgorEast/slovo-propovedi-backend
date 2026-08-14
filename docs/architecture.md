# Архитектура backend: bootstrap, окружение, запуск

Документ фиксирует, **как поднимается** NestJS-приложение (`src/main.ts`), какие глобальные механизмы включены, какие переменные окружения он читает и как его запускать/тестировать. Соглашения по валидации и кодогенерации — в [`conventions.md`](./conventions.md).

**Слой:** backend (bootstrap)
**Статус:** актуально

## Bootstrap: `src/main.ts`

Точка входа создаёт приложение из корневого `AppModule` и настраивает его в порядке вызовов.

```ts
const app = await NestFactory.create(AppModule);
```

### CORS: allow-list

Разрешены только перечисленные origin'ы, `credentials: true`, методы `GET POST PATCH PUT DELETE OPTIONS`:

| Origin | Назначение |
|--------|------------|
| `https://slovo-propovedi.ru` | основной сайт |
| `https://www.slovo-propovedi.ru` | www-сайт |
| `https://admin-app.slovo-propovedi.ru` | админ-панель |
| `http://localhost:3000` | локальный Vite-прокси (backend-порт) |
| `http://localhost:4321` | локальный фронтенд (Svelte dev) |
| `http://localhost:8081` | резервный локальный порт |
| `http://localhost:8082` | резервный локальный порт |
| `DOCS_UI_ORIGIN` (опционально) | дополнительный origin, добавляется при наличии в env |

> ⚠️ Список origin'ов **захардкожен** в `main.ts`; он не загружается из конфигурации (кроме опционального `DOCS_UI_ORIGIN`). При добавлении нового frontend-хоста правка — в коде.

### Глобальный Zod-пайп (strict)

`createZodValidationPipe({ strictSchemaDeclaration: true })` регистрируется как глобальный пайп:

```ts
const StrictZodValidationPipe = createZodValidationPipe({
  strictSchemaDeclaration: true,
});
app.useGlobalPipes(new StrictZodValidationPipe());
```

`strictSchemaDeclaration: true` означает: если у роута параметр (body/query/param) не аннотирован Zod-DTO — приложение выбрасывает ошибку. Каждый DTO обязан наследовать `createZodDto(...)` (см. [`conventions.md`](./conventions.md)).

### MinIO bucket на старте

```ts
const minioService = app.get<MinioService>(MinioService);
await minioService.createBucketIfNotExists();
```

На boot гарантированно существует bucket `files` (создаётся при необходимости) и применён public-read policy. Подробности — [`modules/minio.md`](./modules/minio.md).

### Swagger UI на рантайме (только по флагу)

Swagger UI **не генерируется** из кода (`@nestjs/swagger` без декораторов спецификации — валидация через nestjs-zod). При `DOCS_ENABLED === 'true'` `main.ts` на старте **скачивает** удалённую спецификацию и поднимает её на `/swagger-api`:

```ts
if (process.env.DOCS_ENABLED === 'true') {
  try {
    const specUrl =
      process.env.OPENAPI_SPEC_URL ||
      'https://docs.slovo-propovedi.ru/openAPI.yaml';
    const response = await fetch(specUrl);
    const yamlText = await response.text();
    const openApiDoc = yaml.load(yamlText) as OpenAPIObject;
    SwaggerModule.setup('swagger-api', app, openApiDoc);
  } catch (error) {
    // warn + Swagger UI disabled; приложение продолжает работать
  }
}
```

- YAML парсится через `js-yaml`; вход — `OPENAPI_SPEC_URL`, по умолчанию `https://docs.slovo-propovedi.ru/openAPI.yaml`.
- При сбое скачивания/парсинга Swagger UI отключается с `Logger.warn`, приложение не падает.

> ✅ Спецификация живёт во **внешнем** swagger-репозитории `slovo-propovedi-docs` и деплоится на `docs.slovo-propovedi.ru/openAPI.yaml`. Это же — `input` для Orval-кодогенерации (см. [`contracts/rest-api.md`](./contracts/rest-api.md)).

### Порт

```ts
await app.listen('3000');
```

Порт **захардкожен** (`'3000'`), из env не читается.

## Глобальные механизмы

| Механизм | Где включён | Что делает |
|----------|-------------|------------|
| `ZodValidationPipe` (strict) | `main.ts` (глобально) | валидирует все входные body/query/params по Zod-DTO |
| `ZodSerializerInterceptor` | `app.module.ts` (`APP_INTERCEPTOR`) | валидирует/сериализует исходящие ответы по `@ZodResponse` |
| `AuthGuard` | **по-роуту** (`@UseGuards`) | JWT-защита; парсит payload zod-схемой `{ id, email, role }`; **глобального guard нет** |
| `RolesGuard` | **по-роуту** (`@UseGuards` + `@Roles`) | авторизация по ролям (fail-closed); без `@Roles` не ограничивает |

> ⚠️ **Глобального guard нет.** Защита точечная: `@UseGuards(AuthGuard)` на `/auth/profile`, `@UseGuards(AuthGuard, RolesGuard)` + `@Roles(...)` на мутирующих эндпоинтах, `GET /files` и всех `/users*`. Публичные чтения (без аутентификации): `GET /sermons`, `/sermons/:id`, `/sermons/:id/stream-url`, `GET /playlists`, `/playlists/:id`, `GET /section`, `/section/:id`, `/files/:fileName*`, `/health`, `/auth/login`, `/auth/refresh`. Карта guard'ов и матрица ролей — в [`modules/auth.md`](./modules/auth.md) и [`contracts/rest-api.md`](./contracts/rest-api.md).

## Модули

Корневой `app.module.ts` регистрирует (порядок важен не для рантайма, но отражает зависимости):

```ts
imports: [
  ConfigModule.forRoot({ isGlobal: true }),
  HealthModule,
  SectionModule,
  AuthModule,
  UsersModule,
  PlaylistModule,
  TypeOrmModule,
  SermonModule,
  MinioModule,
],
controllers: [AppController],
providers: [
  AppService,
  { provide: APP_INTERCEPTOR, useClass: ZodSerializerInterceptor },
],
```

- `ConfigModule.forRoot({ isGlobal: true })` — env читается через `ConfigService` / `process.env`; отдельного `config/*`-модуля нет.
- `TypeOrmModule` здесь — локальный модуль `src/db/typeorm.module.ts` (подключение к PostgreSQL), не путать с `@nestjs/typeorm`.

## Переменные окружения

Backend читает конфигурацию напрямую из env (без `.env.example`; env поставляет инфра-playbook, внешний по отношению к этому репозиторию).

| Переменная | По умолчанию | Где читается | Назначение |
|------------|--------------|--------------|------------|
| `POSTGRES_HOST` | — | `src/db/typeorm.module.ts` | хост БД (в проде — `slovo-pgbouncer`) |
| `POSTGRES_PORT` | `5432` | `src/db/typeorm.module.ts` | порт БД (в проде — `6432`); валидируется как integer |
| `POSTGRES_USER` | — | `src/db/typeorm.module.ts` | пользователь БД |
| `POSTGRES_PASSWORD` | — | `src/db/typeorm.module.ts` | пароль БД |
| `POSTGRES_DB` | — | `src/db/typeorm.module.ts` | имя БД |
| `JWT_SECRET` | — (обязателен) | `auth.service.ts`, `guard/auth.guard.ts` | секрет access-токена; кидает ошибку, если не задан |
| `JWT_REFRESH_SECRET` | — (обязателен) | `auth.service.ts` | секрет refresh-токена; кидает ошибку, если не задан |
| `MINIO_ENDPOINT` | — | `minio.service.ts` | внутренний endpoint MinIO (data-plane, Docker-сеть) |
| `MINIO_MAIN_PORT_IN` | — | `minio.service.ts` | внутренний порт MinIO |
| `MINIO_ACCESS_KEY` | — | `minio.service.ts` | access key MinIO |
| `MINIO_SECRET_KEY` | — | `minio.service.ts` | secret key MinIO |
| `MINIO_PUBLIC_URI` | — (обязателен для presign) | `minio.service.ts` | browser-facing URI MinIO для presigned-URL |
| `DOCS_ENABLED` | — | `main.ts` | `'true'` включает Swagger UI |
| `OPENAPI_SPEC_URL` | `https://docs.slovo-propovedi.ru/openAPI.yaml` | `main.ts` | источник спецификации для Swagger UI |
| `DOCS_UI_ORIGIN` | — | `main.ts` | дополнительный CORS-origin |

> ✅ `MINIO_PUBLIC_URI` обязателен для presign-клиента (`buildPresignClient` кидает ошибку, если не задан): host входит в SigV4-подпись, поэтому presigned-URL должен генерироваться с тем же host, что увидит браузер.

## Как запускать и тестировать

Все команды — из корня репозитория:

```bash
npm run start:dev        # nest start --watch — hot-reload для разработки
npm run build            # nest build
npm run start:prod       # node dist/main
npm test                 # unit (jest, src/.*\.spec\.ts$)
npm run test:e2e         # jest --config ./test/jest-e2e.json
npm run test:cov         # jest --coverage
npm run gen:schemas      # регенерация src/generated/index.ts (Orval + prettier)
npm run lint             # eslint --fix
```

Нагрузочный локальный запуск: `make up` из корня репозитория поднимает postgres + backend + minio-server (см. [`conventions.md`](./conventions.md)).

## Связанные документы

- [README.md](./README.md) — индекс документации backend-репозитория
- [conventions.md](./conventions.md) — nestjs-zod, DTO, codegen, SQL-миграции
- [db.md](./db.md) — TypeORM-конфиг и карта сущностей
- [modules/auth.md](./modules/auth.md) — JWT, `AuthGuard`, token pair
- [modules/minio.md](./modules/minio.md) — bucket, presign, public-read
- [contracts/rest-api.md](./contracts/rest-api.md) — внешний REST-контракт и конвейер кодогенерации
