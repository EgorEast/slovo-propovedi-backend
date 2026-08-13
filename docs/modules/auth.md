# Модуль `auth` — аутентификация

Авторизация через JWT (Bearer). Никакого Passport / `PassportStrategy` — только собственный `AuthGuard`. Модуль импортирует `UsersModule` (для поиска пользователя) и `JwtModule.register({ global: true })`.

**Слой:** backend (module `auth`)
**Статус:** актуально

## Эндпоинты

| Метод / путь | Guard | DTO ответа | Метод сервиса | Назначение |
|---------------|-------|------------|----------------|------------|
| `POST /auth/login` | публичный | `AuthResponseDto` | `signIn(username, password)` | вход по username/password |
| `POST /auth/refresh` | публичный | `RefreshResponseDto` | `refreshTokens(refreshToken)` | обновление пары токенов |
| `GET /auth/profile` | ✅ `AuthGuard` | `UserResponseDto` | `getProfile(req.user.id)` | профиль текущего админа |

`POST /auth/login` и `POST /auth/refresh` возвращают `200 OK` (`@HttpCode(HttpStatus.OK)`), хотя это POST — типичная для логина семантика (не 201).

## `AuthService` (`src/auth/auth.service.ts`)

### `signIn(username, password)`

1. `usersService.findOneByUsername(username)` → нет пользователя → `UnauthorizedException`.
2. `validatePassword(password, user)`:
   - если пароль — bcrypt-хэш (префиксы `$2a$`, `$2b$`, `$2y$`) → `bcrypt.compare`;
   - если legacy-plaintext — прямое сравнение; при совпадении **пере-хэширует** в bcrypt (10 раундов) и сохраняет через `usersService.updatePassword` (**auto-rehash**).
3. payload `{ id, email }` (email сохранён для backward-compat с уже выданными refresh-токенами; не используется для lookup).
4. `generateTokens(payload)` → пара токенов + `user: { id, name, username, email }`.

### `generateTokens`

```ts
private async generateTokens(payload: { id: string; email: string }) {
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

- `jwtService.verifyAsync(refreshToken, { secret: refreshSecret })` → payload.
- Из старого payload пере-подписывает новую пару (`{ id, email }`).
- Сбой проверки → `UnauthorizedException` («Invalid or expired refresh token»).

### `getProfile(userId)`

- `usersService.findOneById(userId)` → нет → `UnauthorizedException`.
- Возвращает `{ id, name, username, email }`.

### Хелпер-классы

`auth.service.ts` экспортирует классы `UserResponse`, `AuthResponse`, `RefreshResponse` (структуры ответов).

## `AuthGuard` (`src/auth/guard/auth.guard.ts`)

```ts
@Injectable()
export class AuthGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const token = this.extractTokenFromHeader(request);   // Bearer <token>
    if (!token) throw new UnauthorizedException();
    const secret = process.env.JWT_SECRET;                 // обязателен
    try {
      const payload = await this.jwtService.verifyAsync(token, { secret });
      request['user'] = payload;                           // прокидывается дальше
    } catch { throw new UnauthorizedException(); }
    return true;
  }
}
```

- Достаёт токен из заголовка `Authorization: Bearer <token>`.
- Проверяет через `JwtService.verifyAsync` против `JWT_SECRET`.
- Успех → `request['user'] = payload` (дальше доступен как `req.user`).
- **Принимается только access-токен** (refresh-токен подписан другим секретом и сюда не подходит).

## DTO

| Файл | Схема |
|------|-------|
| `src/auth/dto/sign-in-request.dto.ts` | `{ username, password }` |
| `src/auth/dto/refresh-token.dto.ts` | `{ refreshToken }` |
| `src/auth/dto/auth-response.dto.ts` | `{ accessToken, refreshToken, user: { id, name, username, email } }` |
| `src/auth/dto/refresh-response.dto.ts` | `{ accessToken, refreshToken }` |
| `src/auth/dto/user-response.dto.ts` | `{ id, name, username, email }` |

## Связанные документы

- [README.md](./README.md) — индекс модулей
- [users.md](./users.md) — сущность `user` и `UsersService` (findOneByUsername/findOneById/updatePassword)
- [../architecture.md](../architecture.md) — env (`JWT_SECRET`, `JWT_REFRESH_SECRET`), отсутствие глобального guard
- [../contracts/rest-api.md](../contracts/rest-api.md) — контракт `AuthController*`, 401-refresh во фронтенде
- Аутентификация на фронте (login, restore, refresh) — репозиторий `slovo-propovedi-admin`
