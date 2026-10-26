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
| `http://localhost:3000` | локальный Vite-прокси (backend-порт) — **только при `NODE_ENV !== 'production'`** |
| `http://localhost:4321` | локальный фронтенд (Svelte dev) — **только при `NODE_ENV !== 'production'`** |
| `http://localhost:8081` | резервный локальный порт — **только при `NODE_ENV !== 'production'`** |
| `http://localhost:8082` | резервный локальный порт — **только при `NODE_ENV !== 'production'`** |
| `DOCS_UI_ORIGIN` (опционально) | дополнительный origin, добавляется при наличии в env |

> ⚠️ Список origin'ов **захардкожен** в `main.ts`; он не загружается из конфигурации (кроме опционального `DOCS_UI_ORIGIN`). При добавлении нового frontend-хоста правка — в коде.
>
> ✅ Localhost-origin'ы добавляются только когда `NODE_ENV !== 'production'`. Прод-образ выставляет `NODE_ENV=production` (`Dockerfile`), поэтому dev-адреса не попадают в прод-allow-list. Если переменная не задана (локальный запуск), origin'ы остаются доступны — это осознанно, чтобы `npm run start:dev` работал без дополнительной настройки.

### Helmet: security-заголовки

Сразу после создания приложения, **до** CORS и остального middleware, подключается `helmet`:

```ts
app.use(helmet({ contentSecurityPolicy: false }));
```

- **CSP отключён осознанно.** Это JSON API, а не HTML-сайт; единственная HTML-страница — Swagger UI на `/swagger-api`, и она использует inline-скрипты/стили, которые дефолтная политика заблокировала бы. Включать CSP «наполовину» (с `unsafe-inline`) смысла нет: XSS-поверхности в API без HTML нет, а сломанный Swagger — реальный регресс.
- **Остальные заголовки Helmet остаются дефолтными:** `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: no-referrer`, `Strict-Transport-Security`, `X-DNS-Prefetch-Control: off`, `X-Download-Options: noopen`, `X-Permitted-Cross-Domain-Policies: none`, `X-XSS-Protection: 0`, `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy: same-origin`, `Origin-Agent-Cluster: ?1`.
- **`Cross-Origin-Resource-Policy: same-origin` оставлен дефолтным.** CORP ограничивает no-cors-встраивание (img/script/iframe), но не CORS-fetch: фронтенды читают JSON через CORS-запросы, и заголовок им не мешает. Медиа отдаёт **MinIO** на отдельном хосте со своими заголовками, а Swagger UI и его ассеты — same-origin. Если в будущем понадобится встраивать ответы API через `<iframe>`/`<img>` с другого origin, политику придётся ослабить до `cross-origin` — но сейчас таких сценариев нет.

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
- `DOCS_ENABLED` по умолчанию выключен; включать его в проде следует только при необходимости, потому что `/swagger-api` публикует полную схему API без аутентификации. CSP для этого пути отключён (см. раздел Helmet), иначе inline-скрипты Swagger UI не выполнились бы.

> ✅ Спецификация живёт во **внешнем** swagger-репозитории `slovo-propovedi-docs` и деплоится на `docs.slovo-propovedi.ru/openAPI.yaml`. Это же — `input` для Orval-кодогенерации (см. [`contracts/rest-api.md`](./contracts/rest-api.md)).

### Порт

```ts
await app.listen('3000');
```

Порт **захардкожен** (`'3000'`), из env не читается.

### Обработка ошибок процесса

`main.ts` регистрирует процессные обработчики (`Logger('bootstrap')`):

- `unhandledRejection` — `Logger.warn`, процесс продолжает работу. Непройденный promise — ошибка программы, но не повод ронять процесс (systemd всё равно перезапустил бы его, потеряв in-flight-запросы).
- `uncaughtException` — `Logger.error` + `process.exit(1)`. Процесс в неопределённом состоянии; fail-fast, systemd `Restart=always` поднимает его чисто.
- `bootstrap().catch(...)` — при падении старта `Logger.error` + `process.exit(1)`.

Благодаря `Restart=always` systemd-юнит восстанавливается после фатальных ошибок.

## Глобальные механизмы

| Механизм | Где включён | Что делает |
|----------|-------------|------------|
| `ZodValidationPipe` (strict) | `main.ts` (глобально) | валидирует все входные body/query/params по Zod-DTO |
| `ZodSerializerInterceptor` | `app.module.ts` (`APP_INTERCEPTOR`) | валидирует/сериализует исходящие ответы по `@ZodResponse` |
| `ThrottlerGuard` | `app.module.ts` (`APP_GUARD`, **глобально**) + `@Throttle` на auth-роутах | rate limiting по IP: 300/мин базово, `POST /auth/login` — 10/мин, `POST /auth/refresh` — 30/мин; превышение → `429` |
| `AuthGuard` | **по-роуту** (`@UseGuards`) | JWT-защита; парсит payload zod-схемой `{ id, email, role }` |
| `RolesGuard` | **по-роуту** (`@UseGuards` + `@Roles`) | авторизация по ролям (fail-closed); без `@Roles` не ограничивает |

> ⚠️ **Глобального auth-guard'а нет.** Защита точечная: `@UseGuards(AuthGuard)` на `/auth/profile`, `@UseGuards(AuthGuard, RolesGuard)` + `@Roles(...)` на мутирующих эндпоинтах, `GET /files`, всех `/users*` и обоих `/invidious-instances*`. Публичные чтения (без аутентификации): `GET /sermons`, `/sermons/:id`, `GET /playlists`, `/playlists/:id`, `GET /section`, `/section/:id`, `/files/:fileName`, `/health`, `/auth/login`, `/auth/refresh`. Единственный глобальный guard — `ThrottlerGuard` (rate limiting); он не аутентифицирует. Карта guard'ов, лимиты и `trust proxy` — в [`modules/auth.md`](./modules/auth.md); матрица ролей — в [`contracts/rest-api.md`](./contracts/rest-api.md).

## Модули

Корневой `app.module.ts` регистрирует (порядок важен не для рантайма, но отражает зависимости):

```ts
imports: [
  ConfigModule.forRoot({ isGlobal: true }),
  ThrottlerModule.forRoot({
    throttlers: [{ name: 'default', ttl: minutes(1), limit: 300 }],
  }),
  HealthModule,
  SectionModule,
  AuthModule,
  UsersModule,
  PlaylistModule,
  TypeOrmModule,
  SermonModule,
  InvidiousInstancesModule,
  MinioModule,
],
controllers: [AppController],
providers: [
  AppService,
  { provide: APP_INTERCEPTOR, useClass: ZodSerializerInterceptor },
  { provide: APP_GUARD, useClass: ThrottlerGuard },
],
```

- `ConfigModule.forRoot({ isGlobal: true })` — env читается через `ConfigService` / `process.env`; отдельного `config/*`-модуля нет.
- `ThrottlerModule.forRoot(...)` + `APP_GUARD` (`ThrottlerGuard`) — глобальный rate limiting по IP; строгие лимиты auth-роутов задаются `@Throttle` в контроллере (см. [`modules/auth.md`](./modules/auth.md)).
- `TypeOrmModule` здесь — локальный модуль `src/db/typeorm.module.ts` (подключение к PostgreSQL), не путать с `@nestjs/typeorm`.

## Переменные окружения

Backend читает конфигурацию напрямую из env. Для прода её поставляет инфра-playbook /
`.forgejo/workflows/release.yml` (из Forgejo org-level переменных и секретов); для локальной
разработки — `.env` в корне репозитория (см. `.env.example`), которую `ConfigModule.forRoot()`
подхватывает автоматически (dotenv под капотом) при `npm run start:dev`/`start`. Отдельные
Node-скрипты, которые не проходят через Nest bootstrap (`gen:schemas` → `orval.config.mjs`),
`.env` не видят сами — `gen:schemas` явно грузит его через `node --env-file-if-exists=.env`.

| Переменная | По умолчанию | Где читается | Назначение |
|------------|--------------|--------------|------------|
| `POSTGRES_HOST` | — | `src/db/typeorm.module.ts` | хост БД (в проде — `slovo-pgbouncer`) |
| `POSTGRES_PORT` | `5432` | `src/db/typeorm.module.ts` | порт БД (в проде — `6432`); валидируется как integer |
| `POSTGRES_USER` | — | `src/db/typeorm.module.ts` | пользователь БД |
| `POSTGRES_PASSWORD` | — | `src/db/typeorm.module.ts` | пароль БД |
| `POSTGRES_DB` | — | `src/db/typeorm.module.ts` | имя БД |
| `NODE_ENV` | — | `main.ts` | `'production'` отключает localhost-origin'ы в CORS allow-list; выставляется в `Dockerfile` |
| `JWT_SECRET` | — (обязателен) | `auth.service.ts`, `guard/auth.guard.ts` | секрет access-токена; кидает ошибку, если не задан или короче 32 символов |
| `JWT_REFRESH_SECRET` | — (обязателен) | `auth.service.ts` | секрет refresh-токена; кидает ошибку, если не задан или короче 32 символов |
| `MINIO_ENDPOINT` | — | `minio.service.ts` | внутренний endpoint MinIO (data-plane, Docker-сеть) |
| `MINIO_MAIN_PORT_IN` | — | `minio.service.ts` | внутренний порт MinIO |
| `MINIO_ACCESS_KEY` | — | `minio.service.ts` | access key MinIO |
| `MINIO_SECRET_KEY` | — | `minio.service.ts` | secret key MinIO |
| `MINIO_PUBLIC_URI` | — (обязателен) | `minio.service.ts` | browser-facing URI MinIO; база статических URL `${MINIO_PUBLIC_URI}/files/<name>` |
| `DOCS_ENABLED` | — | `main.ts` | `'true'` включает Swagger UI |
| `DOCS_HOSTNAME` | `docs.slovo-propovedi.ru` | `main.ts` | хост docs-сайта; строит дефолт для `OPENAPI_SPEC_URL` и (в проде) `DOCS_UI_ORIGIN` |
| `OPENAPI_SPEC_URL` | `https://$DOCS_HOSTNAME/openAPI.yaml` | `main.ts` | источник спецификации для Swagger UI |
| `DOCS_UI_ORIGIN` | — | `main.ts` | дополнительный CORS-origin (в проде — `https://$DOCS_HOSTNAME`, см. release.yml) |
| `LANDING_HOSTNAME` | `slovo-propovedi.ru` | `main.ts` | CORS: сам домен + `www.` |
| `WEB_HOSTNAME` | `app.slovo-propovedi.ru` | `main.ts` | CORS: мобильный PWA/web-клиент |

`DOCS_HOSTNAME`/`LANDING_HOSTNAME`/`WEB_HOSTNAME` — org-wide Forgejo
Actions переменные (см. `slovo-propovedi-admin`/`-landing`/`-mobile`/`-docs`); значения выше —
дефолты в коде на случай, если переменная не задана.

> ✅ `MINIO_PUBLIC_URI` — browser-facing база статических URL (`getFileUrl`). Presigned-URL больше не используются: bucket `files` public-read by design, поэтому второй (presign) клиент удалён.

## Как запускать и тестировать

Все команды — из корня репозитория:

```bash
npm run start:dev        # nest start --watch — hot-reload для разработки (typescript@6)
npm run build            # tsgo -p tsconfig.build.json && tsc-alias -p tsconfig.build.json
npm run start:prod       # node dist/main
npm test                 # unit (jest + @swc/jest, src/.*\.spec\.ts$)
npm run test:e2e         # jest --config ./test/jest-e2e.json
npm run test:cov         # jest --coverage
npm run gen:schemas      # регенерация src/generated/index.ts (Orval + prettier)
npm run lint             # eslint --fix
```

> 🪝 Pre-commit hook (husky + lint-staged) прогоняет `eslint --fix` по застейдженным `.ts`-файлам перед коммитом; в CI (`HUSKY=0`) он отключён.

### Сборочный конвейер: `tsgo` + `tsc-alias`

Сборка идёт **не** через `nest build`, а нативным компилятором TypeScript (`tsgo`, dev-пакет `@typescript/native-preview`) с последующим `tsc-alias`:

- `npm run build` = `rimraf dist && tsgo -p tsconfig.build.json && tsc-alias -p tsconfig.build.json`; компиляция — по `tsconfig.build.json` (`rootDir: ./src`, `incremental: false`, исключены `test`/`dist`/`**/*spec.ts`).
- Правки `tsconfig` под `tsgo`: **`baseUrl` удалён** (native-компилятор его не поддерживает), `paths` (`src/*` → `./src/*`) сохранены, `types` сужены до `["node", "jest", "multer"]`. `tsgo` не переписывает path-alias'ы в JS-выводе — это делает `tsc-alias`.
- **`typescript@6` оставлен рядом** (в devDependencies; диапазон намеренно ограничен на уровне минора 6.0, чтобы стандартное разрешение зависимостей не выбрало версию за пределами peer-диапазона `typescript-eslint`): ESLint (`typescript-eslint`) и `nest start`/`start:dev` (`@nestjs/cli`) пока работают через legacy compiler API, которого у `tsgo` нет. Это осознанная временная конфигурация, пока native-компилятор не получит compiler API.

### Тесты: Jest на `@swc/jest`

Unit-тесты (`npm test`) гоняет Jest через трансформ **`@swc/jest`** (декораторы и `emitDecoratorMetadata` включены в конфиге Jest в `package.json`); `ts-jest` из цепочки убран. `testRegex` — `src/.*\.spec\.ts$`; e2e — по отдельному конфигу `test/jest-e2e.json`.

Нагрузочный локальный запуск: `make up` из корня репозитория поднимает postgres + backend + minio-server (см. [`conventions.md`](./conventions.md)).

## Деплой на VPS

Выкат тег-ориентированный: push тега `v*` запускает Forgejo Actions, который стримит исходники на VPS и выполняет там `scripts/vps-deploy.sh`. Скрипт идемпотентен, собирает Docker-образ через buildx-билдер `slovo-constrained` (docker-container) и рестартует systemd-юнит `slovo-backend.service`.

**Миграции — до деплоя.** `synchronize: false`, поэтому схема БД меняется только вручную и **до** выката тега с кодом, который рассчитывает на новую схему (иначе guarded-роуты упадут). Для релиза с `token_version` сначала применяется `sql/migrations/011_add_token_version.sql` (см. [`db.md`](./db.md)), и только затем деплоится тег. Для релиза с отказом от plaintext-паролей сначала применяется `sql/migrations/012_rehash_plaintext_passwords.sql`: новый код не принимает не-bcrypt-хэши, поэтому неприменённая миграция означает невозможность входа для legacy-аккаунтов (fail-closed, но нежелательный).

**Совместимость с фронтендом.** Контракт живёт в `slovo-propovedi-docs`, SDK админки (`slovo-propovedi-admin`) генерируется из него отдельно. Удаление маршрута из спецификации — breaking change: сначала регенерируется и выкатывается фронтенд, затем backend. В частности, `stream-url`-эндпоинты удалены в пользу статических public-read URL — SDK, который ещё зовёт `/sermons/{id}/stream-url`, должен быть обновлён **до** деплоя этого backend-релиза.

**Лимит тела запроса.** Загрузка файла ограничена 100 MB в `FileInterceptor`, а Multer держит тело в памяти. Reverse proxy (Traefik/nginx в `slovo-propovedi-playbook`) должен пропускать body не меньше этого лимита, иначе легитимная загрузка будет отклонена на edge.

**Безопасность пайплайна.** Хост-ключ VPS закреплён в org-секрете `VPS_SSH_KNOWN_HOSTS` (вывод `ssh-keyscan <VPS_HOST>`, один раз снятый с доверенной машины и сверенный с fingerprint на сервере): раннер записывает его в `known_hosts`, а SSH/SCP идут с `StrictHostKeyChecking=yes` — неизвестный или изменившийся ключ рвёт деплой. `ssh-keyscan` на каждом прогоне не используется: на свежем раннере он доверился бы любому ответившему ключу и от MITM не защищал бы. При смене ключа сервера (переустановка VPS) секрет нужно обновить. Значения из ref/переменных (в том числе `DEPLOY_TAG`) передаются на удалённую сторону через `env:` шага и экранируются для удалённого shell, а не вклеиваются в строку команды. Образ собирается строго из `package-lock.json` (`npm ci`), а финальная стадия `Dockerfile` работает под непривилегированным пользователем `node` (systemd-юнит может переопределить uid/gid на `slovo`).

**Rate limiting — два уровня.** На edge Traefik применяет middleware `slovo-rate-limit@file` (label `traefik.http.routers.slovo-backend-api.middlewares` в `scripts/vps-deploy.sh`; сама конфигурация middleware живёт в playbook). В приложении дополнительно работает глобальный `ThrottlerGuard` с жёсткими лимитами на `/auth/login` и `/auth/refresh` (см. [`modules/auth.md`](./modules/auth.md)): эти лимиты версионируются вместе с кодом и не зависят от edge-конфига.

**Граница ответственности.** `vps-deploy.sh` владеет только контейнером `slovo-backend` и своей Docker-сетью `slovo-backend`. Вся общая инфраструктура — Docker, пользователь/группа `slovo`, buildx-билдер `slovo-constrained`, Traefik (`slovo-traefik.service`), PostgreSQL / PgBouncer / MinIO и их Docker-сети (`traefik`, `slovo-postgres`, `slovo-minio`) — принадлежит внешнему `slovo-propovedi-playbook` (Ansible, отдельный репозиторий) и должна быть развёрнута заранее (`just setup-all`). Скрипт её **не создаёт**: при отсутствии любого из этих компонентов деплой падает с явной ошибкой, а не доводит сервер до полусобранного состояния.

После запуска контейнера и перехода systemd-юнита в active (проверка `systemctl is-active`, а не полноценный healthcheck приложения) скрипт выполняет **пост-деплойную очистку** (строго non-fatal — сбой очистки не валит успешный деплой, ошибки логируются как `WARN`):

- `docker image prune --force` — удаляет только dangling-образы (без `--all`); поскольку каждый релиз перезаписывает тег `slovo-backend:latest`, образ предыдущего релиза становится dangling и удаляется — откат выполняется повторным деплоем старого `v*`-тега;
- `docker buildx prune --builder slovo-constrained --keep-storage 4GB --force` — ограничивает кэш билдера 4 ГБ, чтобы том buildkit не рос бесконечно между релизами.

## Связанные документы

- [README.md](./README.md) — индекс документации backend-репозитория
- [conventions.md](./conventions.md) — nestjs-zod, DTO, codegen, SQL-миграции
- [db.md](./db.md) — TypeORM-конфиг и карта сущностей
- [modules/auth.md](./modules/auth.md) — JWT, `AuthGuard`, token pair
- [modules/minio.md](./modules/minio.md) — bucket, public-read, статические URL
- [contracts/rest-api.md](./contracts/rest-api.md) — внешний REST-контракт и конвейер кодогенерации
