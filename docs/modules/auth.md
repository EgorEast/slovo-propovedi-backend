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
| `POST /auth/refresh` | публичный | `RefreshResponseDto` | `refreshTokens(refreshToken)` | обновление пары токенов |
| `GET /auth/profile` | ✅ `AuthGuard` (без `@Roles`) | `UserResponseDto` | `getProfile(req.user.id)` | профиль **любого** аутентифицированного (включая `user`) |

`POST /auth/login` и `POST /auth/refresh` возвращают `200 OK` (`@HttpCode(HttpStatus.OK)`), хотя это POST — типичная для логина семантика (не 201).

> ✅ `/auth/profile` намеренно **без `RolesGuard`**: любой вошедший (в т.ч. роль `user`) может читать свой профиль. Роли применяются только к мутирующим/админским роутам (см. [`../contracts/rest-api.md`](../contracts/rest-api.md)).

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
2. **Пере-запрашивает живого пользователя** `usersService.findOneById(payload.id)` — нет → `UnauthorizedException`.
3. Собирает **свежий** payload `{ id, email, role }` из живого пользователя и подписывает новую пару.

Зачем re-fetch:
- **stale/demoted role вступает в силу при следующем refresh** — пониженный админ не получит новый access-токен со старой ролью;
- **legacy refresh-токены** (выданные до ролей, payload без `role`) автоматически апгрейдятся до ролевых.

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
| `src/auth/dto/auth-response.dto.ts` | `{ accessToken, refreshToken, user: { id, name, username, email, role } }` |
| `src/auth/dto/refresh-response.dto.ts` | `{ accessToken, refreshToken }` |
| `src/auth/dto/user-response.dto.ts` | `{ id, name, username, email, role }` |

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
