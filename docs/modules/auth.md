# Модуль `auth` — аутентификация и авторизация по ролям

Авторизация через JWT (Bearer). Никакого Passport / `PassportStrategy` — только собственные `AuthGuard` + `RolesGuard`. Модуль импортирует `UsersModule` (для поиска пользователя) и `JwtModule.register({ global: true })`.

**Слой:** backend (module `auth`)
**Статус:** актуально

## Роли

Три роли (`UserRole`, `src/users/user-role.enum.ts`): `admin` / `moderator` / `user`. Роль живёт в **JWT-payload** (`{ id, email, role }`) и в **БД** (колонка `user.role`, см. [`../db.md`](../db.md)). Guard'ы:

| Guard | Что проверяет |
|-------|---------------|
| `AuthGuard` | токен валиден (подпись `JWT_SECRET`) **и** payload парсится zod-схемой `{ id: uuid, email, role }` |
| `RolesGuard` | `@Roles(...)` из метаданных содержит роль из payload; **fail-closed** |

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

## `AuthService` (`src/auth/auth.service.ts`)

### `signIn(username, password)`

1. `usersService.findOneByUsername(username)` → нет пользователя → `UnauthorizedException`.
2. `validatePassword(password, user)`:
   - если пароль — bcrypt-хэш (префиксы `$2a$`, `$2b$`, `$2y$`) → `bcrypt.compare`;
   - если legacy-plaintext — прямое сравнение; при совпадении **пере-хэширует** в bcrypt (10 раундов) и сохраняет через `usersService.updatePassword` (**auto-rehash**).
3. payload `{ id, email, role }` — роль из свежезагруженного пользователя.
4. `generateTokens(payload)` → пара токенов + `user: { id, name, username, email, role }`.

### `generateTokens`

```ts
private async generateTokens(payload: { id: string; email: string; role: UserRole }) {
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

> ✅ Секреты обязательны: если `JWT_SECRET` / `JWT_REFRESH_SECRET` не заданы — сервис кидает ошибку. Guard также требует `JWT_SECRET`.

### `refreshTokens(refreshToken)`

1. `jwtService.verifyAsync(refreshToken, { secret: refreshSecret })` — сбой → `UnauthorizedException`.
2. **Fast-fail denylist-check**: sha256(refreshToken) ищется в таблице `revoked_refresh_token` (`isRevoked`) — найден → `UnauthorizedException` (токен уже убит через `logout` или предыдущую ротацию) **до** пере-запроса пользователя.
3. **Пере-запрашивает живого пользователя** `usersService.findOneById(payload.id)` — нет → `UnauthorizedException`.
4. **Ротация**: предъявленный refresh-токен **отзывается в этом же запросе** — его sha256-хэш вставляется в `revoked_refresh_token` (`storeRevokedToken`, `exp` берётся из верифицированного payload, `ON CONFLICT DO NOTHING`). Вставка выполняется **до** подписания новой пары:
   - insert упал → исключение пробрасывается, новых токенов не выдаётся;
   - `ON CONFLICT DO NOTHING` проглотил вставку (хэш уже есть — параллельный logout/ротация победил) → `UnauthorizedException`, sibling-пара не майнится.
5. Собирает **свежий** payload `{ id, email, role }` из живого пользователя и подписывает новую пару.

**Семантика ротации:**
- **Один живой refresh-токен на цепочку**: каждый `/auth/refresh` убивает предъявленный токен и выдаёт свежую пару. Повторный `/auth/refresh` с уже отротированным токеном → `401` (он в denylist).
- **Multi-tab / несколько устройств**: параллельный refresh из второй вкладки или устройства со старым токеном получает `401` (победила ротация) и должен заново пройти `/auth/login`. Гонка двух одновременных refresh с одним токеном не даёт двух живых цепочек.
- **Гонка logout-vs-refresh безопасна без отдельной транзакции**: UNIQUE(`token_hash`) + `ON CONFLICT DO NOTHING` делают сам insert точкой сериализации — если параллельный logout уже сохранил хэш, insert не сработает и новая пара не будет выдана.

Зачем re-fetch:
- **stale/demoted role вступает в силу при следующем refresh** — пониженный админ не получит новый access-токен со старой ролью;
- **legacy refresh-токены** (выданные до ролей, payload без `role`) автоматически апгрейдятся до ролевых.

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
- **access-токен** НЕ в denylist — он остаётся технически валидным до собственного истечения (**≤ 30 минут**). Клиент обязан удалить оба токена при logout; при «утечке» access-токена максимум 30 минут — осознанный компромисс (не ходить в БД на каждый запрос, та же логика, что с устареванием роли);
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
  role: z.enum(UserRole),   // zod v4: native TS enum
});
```

- Достаёт токен из заголовка `Authorization: Bearer <token>`.
- Проверяет через `JwtService.verifyAsync` против `JWT_SECRET`.
- **Парсит payload zod-схемой** (`accessTokenPayloadSchema.parse`) — parse, don't validate: дальше по приложению `request.user` ходит уже доверенным типом `{ id, email, role }`.
- **Любая ошибка** (нет токена, плохая подпись, payload не парсится) → `UnauthorizedException` (fail loud).
- **Legacy access-токены** без `role` НЕ проходят parse → `401` → клиент делает `/auth/refresh`, получает ролевую пару и повторяет запрос (механизм refresh-retry в админке).
- **Принимается только access-токен** (refresh-токен подписан другим секретом и сюда не подходит).

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

## Роль в access-токене и её «устаревание»

Роль копируется в access-токен при подписи, поэтому **до истечения access-токена (≤ 30 мин) роль в нём может устареть**: пониженный/повышенный пользователь продолжит действовать со старой ролью, пока жив access-токен. Это осознанный компромисс (не ходить в БД на каждый запрос). Изменения роли вступают в силу:
- **немедленно** для долгих сессий — при `/auth/refresh` (re-fetch живого пользователя);
- **максимум через 30 мин** для текущего access-токена.

## Связанные документы

- [README.md](./README.md) — индекс модулей
- [users.md](./users.md) — сущность `user`, роли, `UsersService` (findOneByUsername/findOneById/updatePassword)
- [../architecture.md](../architecture.md) — env (`JWT_SECRET`, `JWT_REFRESH_SECRET`), отсутствие глобального guard
- [../contracts/rest-api.md](../contracts/rest-api.md) — контракт `AuthController*`, матрица ролей, 401-refresh во фронтенде
- Аутентификация на фронте (login, restore, refresh) — репозиторий `slovo-propovedi-admin`
