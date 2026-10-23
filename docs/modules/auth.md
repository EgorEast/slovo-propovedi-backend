# Модуль `auth` — аутентификация и авторизация по ролям

Авторизация через JWT (Bearer). Никакого Passport / `PassportStrategy` — только собственные `AuthGuard` + `RolesGuard` (+ `OptionalAuthGuard` для роутов с опциональной аутентификацией). Модуль импортирует `UsersModule` (для поиска пользователя) и `JwtModule.register({ global: true })`.

**Слой:** backend (module `auth`)
**Статус:** актуально

## Роли

Три роли (`UserRole`, `src/users/user-role.enum.ts`): `admin` / `moderator` / `user`. Роль хранится в **БД** (колонка `user.role`, см. [`../db.md`](../db.md)) и копируется в **JWT-payload** (`{ id, email, role, tokenVersion }`) при подписи; guard'ы:

| Guard | Что проверяет |
|-------|---------------|
| `AuthGuard` | токен валиден (подпись `JWT_SECRET`), payload парсится zod-схемой `{ id: uuid, email, role, tokenVersion? }`, **пользователь существует в БД** и `user.token_version` совпадает с `tokenVersion` из токена (отсутствующий claim = `0`); роль для `request.user` берётся из **живой строки БД** |
| `OptionalAuthGuard` | то же, но токен необязателен: нет токена → `request.user === undefined`, запрос продолжается (`200`); невалидный/просроченный/legacy/отозванный токен → `401` |
| `RolesGuard` | `@Roles(...)` из метаданных содержит роль из `request.user` (живая роль из БД); **fail-closed** |

Пара `@Roles(...)` + `@UseGuards(AuthGuard, RolesGuard)` включается на мутирующих эндпоинтах. Без `@Roles` guard не ограничивает (возвращает `true`) — роут просто authenticated-only.

## Эндпоинты

| Метод / путь | Guard | DTO ответа | Метод сервиса | Назначение |
|---------------|-------|------------|----------------|------------|
| `POST /auth/login` | публичный | `AuthResponseDto` | `signIn(username, password)` | вход по username/password |
| `POST /auth/refresh` | публичный | `RefreshResponseDto` | `refreshTokens(refreshToken)` | обновление пары токенов (**ротация**: предъявленный refresh-токен отзывается) |
| `POST /auth/logout` | ✅ `AuthGuard` (без `@Roles`) | `204` (без тела) | `logout(refreshToken)` | отзыв refresh-токена (denylist) |
| `GET /auth/profile` | ✅ `AuthGuard` (без `@Roles`) | `UserResponseDto` | `getProfile(req.user.id)` | профиль **любого** аутентифицированного (включая `user`) |

`POST /auth/login` и `POST /auth/refresh` возвращают `200 OK` (`@HttpCode(HttpStatus.OK)`), хотя это POST — типичная для логина семантика (не 201). `POST /auth/logout` возвращает **`204 No Content`** (как `PATCH /users/:id/password` и `DELETE /users/:id`) — тело отсутствует, повторный logout с тем же токеном тоже `204` (идемпотентность).

> ✅ `/auth/profile` и `/auth/logout` намеренно **без `RolesGuard`**: любой вошедший (в т.ч. роль `user`) может читать свой профиль и выйти из системы. Роли применяются только к мутирующим/админским роутам (см. [`../contracts/rest-api.md`](../contracts/rest-api.md)).

## Ограничение частоты запросов (rate limiting)

Онлайн-подбор пароля на `/auth/login` и `/auth/refresh` ограничен на уровне приложения через `@nestjs/throttler`. `ThrottlerModule.forRoot(...)` подключён в `src/app.module.ts`, а `ThrottlerGuard` зарегистрирован **глобально** через `APP_GUARD` — это единственный глобальный guard (авторизация по-прежнему per-route, см. [`../architecture.md`](../architecture.md)).

| Роут | Лимит | Как задан |
|------|-------|-----------|
| все роуты (базовый лимит) | **300 запросов / мин** на IP | `ThrottlerModule.forRoot({ throttlers: [{ ttl: minutes(1), limit: 300 }] })` |
| `POST /auth/login` | **10 запросов / мин** на IP | `@Throttle({ default: { limit: 10, ttl: minutes(1) } })` |
| `POST /auth/refresh` | **30 запросов / мин** на IP | `@Throttle({ default: { limit: 30, ttl: minutes(1) } })` |
| `POST /auth/logout`, `GET /auth/profile` | базовый лимит (300/мин) | без `@Throttle` |

- Базовый лимит намеренно щедрый: публичный каталог (`GET /sermons`, `/playlists`, `/section`, `/files/:fileName` и т.д.) при обычной нагрузке его не достигает.
- `refresh` мягче логина, потому что SPA штатно делает refresh-retry после `401`; при этом 30/мин всё равно не даёт перебирать refresh-токены.
- Ключ лимита — **IP + handler** (`ThrottlerGuard.getTracker` → `req.ip`, IPv6 нормализуется до подсети). Лимит **не** учитывает username: несколько логинов с одного IP (в т.ч. разные учётные записи за общим NAT) делят один счётчик login-роута.
- Превышение → `429 Too Many Requests` с телом `{ "statusCode": 429, "message": "Too many requests. Please try again later." }`; guard также выставляет `Retry-After` и `X-RateLimit-*`. Внутренние детали (имена классов/ключей) наружу не попадают.
- Хранилище — **in-memory** (`ThrottlerStorageService`, без Redis): сервис живёт в одном контейнере, счётчики сбрасываются при рестарте. При горизонтальном масштабировании (несколько реплик) потребовалось бы общее хранилище.
- Rate limiting приложения **дополняет** edge-лимит Traefik (`slovo-rate-limit@file` в `scripts/vps-deploy.sh`), а не заменяет его: app-лимит работает и при отключённом/неверно настроенном edge-middleware.

### `trust proxy` и реальный IP клиента

В `src/main.ts` приложение создаётся как `NestExpressApplication` и вызывает `app.set('trust proxy', 1)`. В проде перед контейнером ровно один hop — Traefik: он добавляет реальный адрес клиента в `X-Forwarded-For`, а `trust proxy = 1` заставляет Express доверять только сокету (самому Traefik) и брать из цепочки **правый непроверенный** адрес — реальный клиент.

- Без `trust proxy` `req.ip` был бы адресом gateway/контейнерной сети, и все клиенты попадали бы в один rate-limit bucket (лимит «на IP» выродился бы в глобальный).
- `trust proxy = true` (доверять всей цепочке) позволил бы клиенту подделать `X-Forwarded-For` и обходить лимиты.
- Локальная разработка идёт без прокси: если клиент не присылает `X-Forwarded-For`, Express берёт адрес сокета, т.е. `req.ip` корректен. Ручная подделка заголовка возможна только при прямом доступе к приложению (dev), в проде её отсекает единственный доверенный hop Traefik.

### Аудит неудачных входов

`AuthService` логирует неудачную попытку входа (`Logger` с контекстом `AuthService`) **и для неизвестного username, и для неверного пароля**:

```text
WARN [AuthService] Failed sign-in attempt for username="someone"
```

- Логируется **только username** (через `JSON.stringify`, чтобы кавычки/переводы строк в имени не подделывали строки лога); пароль, токены и прочие креды в лог не попадают.
- Ответ не меняется: остаётся generic `401 Invalid credentials` для обоих случаев — перечисление пользователей (enumeration) не вводится. Лог служит для обнаружения атак, блокировку обеспечивает rate limiting выше.

## `AuthService` (`src/auth/auth.service.ts`)

### `signIn(username, password)`

1. `usersService.findOneByUsername(username)` → нет пользователя → `UnauthorizedException`.
2. `validatePassword(password, user)`:
   - если пароль — bcrypt-хэш (префиксы `$2a$`, `$2b$`, `$2y$`) → `bcrypt.compare`;
   - если legacy-plaintext — прямое сравнение; при совпадении **пере-хэширует** в bcrypt (10 раундов) и сохраняет через `usersService.updatePassword` (**auto-rehash**).
3. payload `{ id, email, role, tokenVersion }` — роль и `tokenVersion` из свежезагруженного пользователя.
4. `generateTokens(payload)` → пара токенов + `user: { id, name, username, email, role }`.

### `generateTokens`

```ts
private async generateTokens(payload: {
  id: string;
  email: string;
  role: UserRole;
  tokenVersion: number;
}) {
  const [accessToken, refreshToken] = await Promise.all([
    this.jwtService.signAsync(payload, { secret: this.accessSecret, expiresIn: '30m' }),
    this.jwtService.signAsync(payload, { secret: this.refreshSecret, expiresIn: '30d' }),
  ]);
  return { accessToken, refreshToken };
}
```

| Токен | Секрет | Срок | Назначение |
|-------|--------|------|------------|
| access | `JWT_SECRET` | `30m` | авторизация запросов (его принимает `AuthGuard`) |
| refresh | `JWT_REFRESH_SECRET` | `30d` | обновление пары |

Оба токена несут `tokenVersion` — версию сессии на момент подписи (см. ниже). Access-токен дополнительно проверяется по живой строке БД на каждом запросе.

> ✅ Секреты обязательны: если `JWT_SECRET` / `JWT_REFRESH_SECRET` не заданы — сервис кидает ошибку. Guard также требует `JWT_SECRET`.

### `refreshTokens(refreshToken)`

1. `jwtService.verifyAsync(refreshToken, { secret: refreshSecret })` — сбой → `UnauthorizedException`.
2. **Fast-fail denylist-check**: sha256(refreshToken) ищется в таблице `revoked_refresh_token` (`isRevoked`) — найден → `UnauthorizedException` (токен уже убит через `logout` или предыдущую ротацию) **до** пере-запроса пользователя.
3. **Пере-запрашивает живого пользователя** `usersService.findOneById(payload.id)` — нет → `UnauthorizedException`.
4. **Проверка версии сессии**: `user.tokenVersion !== (payload.tokenVersion ?? 0)` → `UnauthorizedException` («Refresh token has been revoked»). Токен, выпущенный до смены пароля, мёртв, даже если подпись и `exp` ещё валидны; отсутствие claim'а у legacy-токена означает версию `0`.
5. **Ротация**: предъявленный refresh-токен **отзывается в этом же запросе** — его sha256-хэш вставляется в `revoked_refresh_token` (`storeRevokedToken`, `exp` берётся из верифицированного payload, `ON CONFLICT DO NOTHING`). Вставка выполняется **до** подписания новой пары:
   - insert упал → исключение пробрасывается, новых токенов не выдаётся;
   - `ON CONFLICT DO NOTHING` проглотил вставку (хэш уже есть — параллельный logout/ротация победил) → `UnauthorizedException`, sibling-пара не майнится.
6. Собирает **свежий** payload `{ id, email, role, tokenVersion }` из живого пользователя и подписывает новую пару.

**Семантика ротации:**
- **Один живой refresh-токен на цепочку**: каждый `/auth/refresh` убивает предъявленный токен и выдаёт свежую пару. Повторный `/auth/refresh` с уже отротированным токеном → `401` (он в denylist).
- **Multi-tab / несколько устройств**: параллельный refresh из второй вкладки или устройства со старым токеном получает `401` (победила ротация) и должен заново пройти `/auth/login`. Гонка двух одновременных refresh с одним токеном не даёт двух живых цепочек.
- **Гонка logout-vs-refresh безопасна без отдельной транзакции**: UNIQUE(`token_hash`) + `ON CONFLICT DO NOTHING` делают сам insert точкой сериализации — если параллельный logout уже сохранил хэш, insert не сработает и новая пара не будет выдана.

Зачем re-fetch:
- **stale/demoted role вступает в силу немедленно** — пониженный админ не получит ни новый access-токен со старой ролью, ни доступ к живому guard'у (роль читается из БД на каждом запросе, см. ниже);
- **version-check** убивает refresh-токены, выпущенные до смены пароля;
- **legacy refresh-токены** (выданные до ролей/версионирования, payload без `role`/`tokenVersion`) проходят проверку как версия `0` и апгрейдятся до актуального payload'а.

### `logout(refreshToken)`

Выход из системы через **denylist** (таблица `revoked_refresh_token`, см. [`../db.md`](../db.md)). Логика:

1. `jwtService.verifyAsync(refreshToken, { secret: refreshSecret })`:
   - **невалидный/просроченный** токен → `return` (**всё равно `204`**, идемпотентность — непригодному токену нечего отзывать);
   - валидный → payload `{ id, exp }` (id пользователя, срок токена).
2. **FK-guard**: `usersService.findOneById(payload.id)` — пользователь удалён → `return` (**тоже `204`**, токен и так мёртв: `/auth/refresh` пере-запрашивает пользователя и дал бы `401`; хранить строку нельзя — FK `revoked_refresh_token.user_id → user(id)` упал бы `500`).
3. `tokenHash = sha256(refreshToken)` (hex) — **в БД хранится только хэш**, не сам токен: утечка дампа БД не даёт «оживить» refresh-токен.
4. **Opportunistic purge**: `DELETE FROM revoked_refresh_token WHERE expires_at < now()` — строки с уже истёкшими токенами мусорные, чистим по ходу, без scheduled job.
5. `INSERT ... ON CONFLICT DO NOTHING` (`orIgnore()`) — повторный logout с тем же токеном не падает (UNIQUE на `token_hash`), остаётся `204`.

**Семантика отзыва (ротация):**
- **refresh-токен умирает немедленно**: `logout` кладёт его хэш в denylist; `/auth/refresh` **также** отзывает предъявленный токен при ротации — в каждый момент времени в цепочке жив **один** refresh-токен;
- повторный `/auth/refresh` с уже отротированным/отозванным токеном → `401` (в т.ч. из второй вкладки/устройства, где ещё лежит старый токен) — клиент должен заново пройти `/auth/login`;
- **access-токен** НЕ в denylist — он остаётся технически валидным до собственного истечения (**≤ 30 минут**). Клиент обязан удалить оба токена при logout; при «утечке» access-токена максимум 30 минут — осознанный компромисс. `logout` **не** меняет `token_version` (иначе выход на одном устройстве убивал бы все остальные); сессии отзываются только сменой пароля — она бампает версию и убивает и access, и refresh немедленно;
- строки denylist живут до `exp` токена (после — токен и так просрочен).

### `getProfile(userId)`

- `usersService.findOneById(userId)` → нет → `UnauthorizedException`.
- Возвращает `{ id, name, username, email, role }`.

### Типы ответов

`auth.service.ts` **не декларирует** свои классы `UserResponse`/`AuthResponse`/`RefreshResponse` — единый источник истины для формы ответа это zod-DTO (`src/auth/dto/*.dto.ts`, сгенерированные схемы). Сервис возвращает обычные объекты, которые на границе валидирует `ZodSerializerInterceptor` (`@ZodResponse`). В прошлом здесь был дубликат `UserResponse`; он удалён (роль не была бы в нём → `@ZodResponse` упал бы 500).

## `AuthGuard` (`src/auth/guard/auth.guard.ts`)

```ts
export const accessTokenPayloadSchema = z.object({
  id: z.string().uuid(),
  email: z.string(),
  role: z.enum(UserRole),                      // zod v4: native TS enum
  tokenVersion: z.number().int().nonnegative().optional(), // legacy = 0
});
```

- Достаёт токен из заголовка `Authorization: Bearer <token>`.
- Проверяет через `JwtService.verifyAsync` против `JWT_SECRET`.
- **Парсит payload zod-схемой** (`accessTokenPayloadSchema.parse`) — parse, don't validate: дальше по приложению `request.user` ходит уже доверенным типом `{ id, email, role, tokenVersion? }`.
- **Загружает живого пользователя** через `usersService.findByIdForAuth(id)` (SELECT только `id`, `role`, `token_version`):
  - пользователь удалён → `401`;
  - `user.token_version !== (payload.tokenVersion ?? 0)` → `401` с сообщением «Session has been revoked. Please sign in again.» — клиентский refresh-retry получит такой же отказ на `/auth/refresh` и обязан вернуть пользователя на логин;
  - иначе `request.user = { ...payload, role: user.role }` — **роль берётся из БД**, а не из токена.
- **Любая ошибка** верификации/парсинга (нет токена, плохая подпись, payload не парсится) → `UnauthorizedException` (fail loud); ошибка БД при загрузке пользователя пробрасывается как `500`, а не маскируется под `401`.
- **Legacy access-токены** без `role` НЕ проходят parse → `401` → клиент делает `/auth/refresh`, получает ролевую пару и повторяет запрос (механизм refresh-retry в админке). Legacy-токены без `tokenVersion` считаются версией `0`.
- **Принимается только access-токен** (refresh-токен подписан другим секретом и сюда не подходит).
- **Стоимость:** один SELECT по PK на каждый аутентифицированный запрос — цена немедленного применения удаления/понижения/смены пароля (см. ниже).

## `OptionalAuthGuard` (`src/auth/guard/optional-auth.guard.ts`)

`extends AuthGuard` (переиспользует `extractTokenFromHeader` / `resolveSecret` / `verifyOrThrow` / `resolveLiveUser`) и переопределяет `canActivate` для **опциональной** аутентификации:

- Валидный Bearer-токен → `request.user = { id, email, role }` (та же проверка живой строки БД и версии, что в `AuthGuard`), запрос продолжается.
- Нет токена / не Bearer → `request.user` остаётся `undefined`, запрос продолжается анонимно (`200`).
- **Невалидный / просроченный / отозванный / legacy-токен без `role` → `401`** — токен, который присутствует, но не проходит проверку, не деградирует в анонима: клиент обновит токен и повторит запрос.
- Отсутствие `JWT_SECRET` — серверная мисконфигурация, а не проблема токена: секрет резолвится **вне** `try`, поэтому ошибка пробрасывается (fail loud), а не превращается в `401` или в анонима.

## `RolesGuard` (`src/auth/guard/roles.guard.ts`)

- Читает требуемые роли из метаданных: `reflector.getAllAndOverride(ROLES_KEY, [handler, class])`.
- Нет `@Roles(...)` → `true` (guard не ограничивает).
- `user` отсутствует или нет `user.role` → **`ForbiddenException` (fail-closed)**.
- Роль не входит в требуемый набор → `ForbiddenException`.
- Иначе → `true`.

Декоратор `@Roles(...roles: UserRole[])` — в `src/auth/decorators/roles.decorator.ts` (`SetMetadata(ROLES_KEY, roles)`).

## DTO

| Файл | Схема |
|------|-------|
| `src/auth/dto/sign-in-request.dto.ts` | `{ username, password }` |
| `src/auth/dto/refresh-token.dto.ts` | `{ refreshToken }` |
| `src/auth/dto/logout-request.dto.ts` | `{ refreshToken }` |
| `src/auth/dto/auth-response.dto.ts` | `{ accessToken, refreshToken, user: { id, name, username, email, role } }` |
| `src/auth/dto/refresh-response.dto.ts` | `{ accessToken, refreshToken }` |
| `src/auth/dto/user-response.dto.ts` | `{ id, name, username, email, role }` |

## Denylist-сущность `RevokedRefreshToken`

`src/auth/entities/revoked-refresh-token.entity.ts`, таблица `revoked_refresh_token` (см. [`../db.md`](../db.md)). Регистрируется в `AuthModule` через `TypeOrmModule.forFeature([RevokedRefreshToken])` (рядом с существующими импортами `UsersModule` + глобальный `JwtModule`).

## Роль и версия сессии в access-токене

Роль копируется в access-токен при подписи, но **источником истины остаётся БД**: `AuthGuard` на каждом запросе загружает `id`/`role`/`token_version` и подставляет **живую** роль в `request.user`. Поэтому:
- понижение/повышение роли действует **немедленно** (следующий же запрос);
- удалённый пользователь получает `401` немедленно;
- смена пароля бампает `user.token_version`, и все access/refresh-токены со старой версией отклоняются сразу — пользователь должен войти заново.

`token_version` — целочисленный счётчик (`NOT NULL DEFAULT 0`). `signIn` и `refreshTokens` подписывают пару текущим значением; `UsersService.changePassword` инкрементирует его в том же `UPDATE`, что и хэш пароля (см. [`users.md`](./users.md)). `updatePassword` (auto-rehash legacy-пароля при логине) версию **не** трогает — те же креды остаются валидными.

## Связанные документы

- [README.md](./README.md) — индекс модулей
- [users.md](./users.md) — сущность `user`, роли, `UsersService` (findOneByUsername/findOneById/updatePassword)
- [../architecture.md](../architecture.md) — env (`JWT_SECRET`, `JWT_REFRESH_SECRET`), глобальный `ThrottlerGuard` и per-route auth-guard'ы
- [../contracts/rest-api.md](../contracts/rest-api.md) — контракт `AuthController*`, матрица ролей, 401-refresh во фронтенде
- Аутентификация на фронте (login, restore, refresh) — репозиторий `slovo-propovedi-admin`
