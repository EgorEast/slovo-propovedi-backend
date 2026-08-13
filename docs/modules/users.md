# Модуль `users` — админ-аккаунты

Полноценный CRUD-модуль админ-аккаунтов + смена пароля. Креды админов живут здесь и потребляются и `AuthService` (логин, профиль), и `UsersController` (управление из админки). **Все пользователи — админы, ролей нет.**

**Слой:** backend (module `users`)
**Статус:** актуально

> ⚠️ `users` — единственный модуль, где **все** 6 эндпоинтов защищены `AuthGuard`: здесь нет публичных чтений (в отличие от `section`/`sermon`/`playlist`, где `GET` публичны). Логин/профиль — в [`auth.md`](./auth.md).

## Эндпоинты

| Метод / путь | Guard | Body/Param | DTO ответа | Метод сервиса |
|---------------|-------|------------|------------|----------------|
| `POST /users` | ✅ `AuthGuard` | body `CreateUserDto` | `UserResponseDto` | `create` |
| `GET /users` | ✅ `AuthGuard` | — | `UserListResponseDto` | `findAll` |
| `GET /users/:id` | ✅ `AuthGuard` | param `IdParamDto` | `UserResponseDto` | `findOne` |
| `PATCH /users/:id` | ✅ `AuthGuard` | param + body `UpdateUserDto` | `UserResponseDto` | `update` |
| `PATCH /users/:id/password` | ✅ `AuthGuard` | param + body `ChangePasswordDto` | — (`204 No Content`) | `changePassword` |
| `DELETE /users/:id` | ✅ `AuthGuard` | param `IdParamDto` | — (`204 No Content`) | `remove` |

`@Controller('users')` (`src/users/users.controller.ts`).

> ✅ Смена пароля — **отдельный эндпоинт** `PATCH /users/:id/password`, а не поле в `UpdateUserDto`. Пароль **никогда** не участвует в ответах и в обновлении профиля. `changePassword` и `remove` возвращают `204 No Content` (`@HttpCode(HttpStatus.NO_CONTENT)`), а не `StatusResponseDto` как у других модулей.

## Сущность `User` (`src/users/entities/user.entity.ts`)

Таблица `user` (`@Entity('user')`). Креды живут здесь.

| Поле | Колонка | Тип | Ограничения |
|------|---------|-----|-------------|
| `id` | `id` | uuid | PK |
| `name` | `name` | varchar | NOT NULL, `@IsNotEmpty` |
| `email` | `email` | varchar | UNIQUE, `@IsEmail`, `@IsNotEmpty` |
| `username` | `username` | varchar | UNIQUE, `@IsString`, `@IsNotEmpty` |
| `password` | `password` | varchar | bcrypt-хэш |

> ⚠️ Единственная сущность, использующая **class-validator** (`@IsNotEmpty`, `@IsEmail`, `@IsString`) вместо Zod-DTO. Это legacy: class-validator здесь не участвует в HTTP-валидации (глобальный strict-пайп требует Zod), а используется как декларативные метаданные сущности. См. [`../conventions.md`](../conventions.md).

## `UsersService` (`src/users/users.service.ts`)

Публичные методы (ошибки оборачиваются в `HttpException`):

| Метод | Назначение |
|-------|------------|
| `findAll()` | список всех админов → `UserResponse[]` |
| `findOne(id)` | поиск по `id` (иначе `NotFoundException`) |
| `create(dto)` | создание: bcrypt-хэш пароля + сохранение |
| `update(id, dto)` | частичное обновление (только заданные поля) |
| `changePassword(id, dto)` | смена пароля (bcrypt-хэш + `updatePassword`) |
| `remove(id, currentUserId)` | удаление (с защитой от блокировки, см. ниже) |
| `findOneByUsername(username)` | поиск по `username` (используется при логине) |
| `findOneById(id)` | поиск по `id` (используется в `getProfile`) |
| `updatePassword(id, hashedPassword)` | обновление пароля (используется при auto-rehash legacy-пароля) |

- **Пароль хэшируется** `bcrypt` (10 раундов, `BCRYPT_ROUNDS = 10`) в `create` и `changePassword`.
- **Приватный `toResponse(user)`** отдаёт только `{ id, name, username, email }` — **пароль НИКОГДА не попадает в ответы**. Два слоя защиты:
  1. явный маппинг полей в `toResponse` (исключает `password`);
  2. строгие Zod-схемы `UserResponseDto`/`UserListResponseDto` на границе (`@ZodResponse`) — даже случайно добавленный ключ отбросит `ZodSerializerInterceptor`.
- **Конфликт уникальности** (`email`/`username`, PG-код `23505`) → `ConflictException` «Пользователь с таким email или username уже существует».

### Защита self-delete / last-admin (`remove`) → 403

Так как **ролей нет и все пользователи — админы**, случайное удаление единственного админа заблокировало бы систему (войти станет некому). Поэтому `remove` запрещает два сценария, оба → `ForbiddenException`:

| Проверка | Условие | Сообщение |
|----------|---------|-----------|
| self-delete | `id === currentUserId` | «Нельзя удалить собственный аккаунт» |
| last-admin | `count()` по таблице ≤ 1 | «Нельзя удалить последнего администратора» |

`currentUserId` берётся из JWT-пайлоада `req.user.id` (см. `AuthenticatedRequest` в контроллере). Порядок проверок: сначала self-delete, затем существование записи (`NotFoundException`), затем счётчик админов.

`src/users/users.module.ts`:

```ts
@Module({
  imports: [TypeOrmModule.forFeature([User])],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService, TypeOrmModule],   // AuthService использует UsersService
})
export class UsersModule {}
```

> ✅ `UsersModule` теперь имеет `controllers: [UsersController]` (полноценный HTTP-контроллер), а также по-прежнему экспортирует `UsersService` **и** `TypeOrmModule` — это позволяет `AuthModule` пользоваться сервисом.

## DTO

| Файл | Схема |
|------|-------|
| `src/users/dto/create-user.dto.ts` | `UsersControllerCreateBody` (`{ name, email, username, password }`) |
| `src/users/dto/update-user.dto.ts` | `UsersControllerUpdateBody` (`{ name?, email?, username? }`) |
| `src/users/dto/change-password.dto.ts` | `UsersControllerChangePasswordBody` (`{ password }`) |
| `src/users/dto/user-response.dto.ts` | `UsersControllerCreateResponse` (create/findOne/update) |
| `src/users/dto/user-list-response.dto.ts` | `UsersControllerFindAllResponse` (findAll) |

## Связанные документы

- [README.md](./README.md) — индекс модулей
- [auth.md](./auth.md) — как `UsersService` используется в `signIn`/`getProfile`/auto-rehash
- [shared.md](./shared.md) — `IdParamDto`
- [../db.md](../db.md) — таблица `user` в схеме БД
- [../conventions.md](../conventions.md) — note про legacy class-validator
- [../contracts/rest-api.md](../contracts/rest-api.md) — контракт `UsersController*`
- Домен users на фронте и экраны управления пользователями — репозиторий `slovo-propovedi-admin`
