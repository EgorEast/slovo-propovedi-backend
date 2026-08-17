# Модуль `users` — аккаунты (admin / moderator / user)

Полноценный CRUD-модуль аккаунтов + смена пароля. Креды живут здесь и потребляются и `AuthService` (логин, профиль), и `UsersController` (управление из админки).

**Ролевая модель (три уровня):**

| Роль | `UserRole` | Доступ |
|------|------------|--------|
| **admin** | `UserRole.Admin` | всё: и контент (sermons/sections/playlists/files), и управление пользователями |
| **moderator** | `UserRole.Moderator` | контент (sermons/sections/playlists/files), **без** users-модуля |
| **user** | `UserRole.User` | только аутентификация и свой профиль (`/auth/profile`) |

Матрица доступа по эндпоинтам — в [`../contracts/rest-api.md`](../contracts/rest-api.md).

**Слой:** backend (module `users`)
**Статус:** актуально

> ⚠️ `users` — единственный модуль, где **все** 6 эндпоинтов защищены `AuthGuard` + `RolesGuard` с `@Roles(UserRole.Admin)`: здесь нет публичных чтений (в отличие от `section`/`sermon`/`playlist`, где `GET` публичны) и даже moderator не имеет доступа. Логин/профиль — в [`auth.md`](./auth.md).

## Эндпоинты

| Метод / путь | Guard | Body/Param | DTO ответа | Метод сервиса |
|---------------|-------|------------|------------|----------------|
| `POST /users` | ✅ `AuthGuard` + `RolesGuard` (admin) | body `CreateUserDto` | `UserResponseDto` | `create` |
| `GET /users` | ✅ `AuthGuard` + `RolesGuard` (admin) | query `FindAllUsersQueryDto` (`page?`, `limit?`) | `UserListResponseDto` | `findAll(page, limit)` |
| `GET /users/:id` | ✅ `AuthGuard` + `RolesGuard` (admin) | param `IdParamDto` | `UserResponseDto` | `findOne` |
| `PATCH /users/:id` | ✅ `AuthGuard` + `RolesGuard` (admin) | param + body `UpdateUserDto` | `UserResponseDto` | `update` |
| `PATCH /users/:id/password` | ✅ `AuthGuard` + `RolesGuard` (admin) | param + body `ChangePasswordDto` | — (`204 No Content`) | `changePassword` |
| `DELETE /users/:id` | ✅ `AuthGuard` + `RolesGuard` (admin) | param `IdParamDto` | — (`204 No Content`) | `remove` |

`@Controller('users')` (`src/users/users.controller.ts`). Все роуты: `@Roles(UserRole.Admin)` + `@UseGuards(AuthGuard, RolesGuard)`.

> ✅ Смена пароля — **отдельный эндпоинт** `PATCH /users/:id/password`, а не поле в `UpdateUserDto`. Пароль **никогда** не участвует в ответах и в обновлении профиля. `changePassword` и `remove` возвращают `204 No Content` (`@HttpCode(HttpStatus.NO_CONTENT)`), а не `StatusResponseDto` как у других модулей.

## Сущность `User` (`src/users/entities/user.entity.ts`)

Таблица `user` (`@Entity('user')`). Креды и роль живут здесь.

| Поле | Колонка | Тип | Ограничения |
|------|---------|-----|-------------|
| `id` | `id` | uuid | PK |
| `name` | `name` | varchar | NOT NULL, `@IsNotEmpty` |
| `email` | `email` | varchar | UNIQUE, `@IsEmail`, `@IsNotEmpty` |
| `username` | `username` | varchar | UNIQUE, `@IsString`, `@IsNotEmpty` |
| `password` | `password` | varchar | bcrypt-хэш |
| `role` | `role` | varchar | NOT NULL, default `'user'`, CHECK `('admin','moderator','user')` |

`UserRole` — TS-енум в `src/users/user-role.enum.ts` (`Admin='admin'`, `Moderator='moderator'`, `User='user'`). Колонка: `@Column({ name: 'role', type: 'varchar', default: UserRole.User })`.

> ⚠️ Единственная сущность, использующая **class-validator** (`@IsNotEmpty`, `@IsEmail`, `@IsString`) вместо Zod-DTO. Это legacy: class-validator здесь не участвует в HTTP-валидации (глобальный strict-пайп требует Zod), а используется как декларативные метаданные сущности. См. [`../conventions.md`](../conventions.md).

## `UsersService` (`src/users/users.service.ts`)

Публичные методы (ошибки оборачиваются в `HttpException`):

| Метод | Назначение |
|-------|------------|
| `findAll(page?, limit?)` | список пользователей → `{ users, count }`; offset-пагинация по `page`/`limit` (порядок `id DESC`), `limit` без `page` — первая страница, `page` без `limit` — `DEFAULT_PAGE_LIMIT = 100` |
| `findOne(id)` | поиск по `id` (иначе `NotFoundException`) |
| `create(dto)` | создание: bcrypt-хэш пароля + сохранение; `role = dto.role ?? UserRole.User` (least privilege) |
| `update(id, dto, currentUserId)` | частичное обновление (только заданные поля) + защита роли (см. ниже) |
| `changePassword(id, dto)` | смена пароля (bcrypt-хэш + `updatePassword`) |
| `remove(id, currentUserId)` | удаление (с защитой от блокировки, см. ниже) |
| `findOneByUsername(username)` | поиск по `username` (используется при логине) |
| `findOneById(id)` | поиск по `id` (используется в `getProfile` и `refreshTokens`) |
| `updatePassword(id, hashedPassword)` | обновление пароля (используется при auto-rehash legacy-пароля) |

- **Пароль хэшируется** `bcrypt` (10 раундов, `BCRYPT_ROUNDS = 10`) в `create` и `changePassword`.
- **Приватный `toResponse(user)`** отдаёт только `{ id, name, username, email, role }` — **пароль НИКОГДА не попадает в ответы**. Два слоя защиты:
  1. явный маппинг полей в `toResponse` (исключает `password`);
  2. строгие Zod-схемы `UserResponseDto`/`UserListResponseDto` на границе (`@ZodResponse`) — даже случайно добавленный ключ отбросит `ZodSerializerInterceptor`.
- **`toUserRole(role)`** — парсинг роли на границе сервиса: zod гарантирует `'admin' | 'moderator' | 'user'`, функция маппит строку в TS-енум `UserRole` (литеральный union не присваивается енуму напрямую).
- **Конфликт уникальности** (`email`/`username`, PG-код `23505`) → `ConflictException` «Пользователь с таким email или username уже существует».

### Защита ролей (`update` / `remove`) → 403

Систему нельзя запереть: удаление или понижение последнего администратора сделало бы вход невозможным. Поэтому:

| Проверка | Где | Условие | Сообщение |
|----------|-----|---------|-----------|
| self-delete | `remove` | `id === currentUserId` | «Нельзя удалить собственный аккаунт» |
| last-admin delete | `remove` | цель — `Admin`, админов ≤ 1 | «Нельзя удалить последнего администратора» |
| self-role-change | `update` | передан `role` и `id === currentUserId` | «Нельзя изменить свою роль» |
| last-admin demotion | `update` | цель — `Admin`, новый `role ≠ admin`, админов ≤ 1 | «Нельзя понизить последнего администратора» |

- `currentUserId` берётся из JWT-пайлоада `req.user.id` (см. `AuthenticatedRequest` в контроллере: `{ id, role }`).
- Проверка self-delete/self-role-change идёт **до** транзакции; загрузка цели, счётчик админов (`WHERE role = 'admin'`) и удаление/сохранение — **в одной TypeORM-транзакции уровня `SERIALIZABLE`** (`dataSource.transaction('SERIALIZABLE', …)`). Гонку «два админа удаляют друг друга / оба понижают» предотвращает именно **изоляция SERIALIZABLE**, а не сам факт транзакции: при `READ COMMITTED` обе транзакции увидели бы старый счётчик админов (≥ 2) и обе прошли бы проверку, оставив ноль админов; сериализуемая изоляция заставит одну из них упасть с `40001` (fail-loud, без повтора).
- Обычного пользователя можно удалить и когда он последний в таблице — блокируется только последний **админ**.

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

> ✅ `UsersModule` экспортирует `UsersService` **и** `TypeOrmModule` — это позволяет `AuthModule` пользоваться сервисом.

## DTO

| Файл | Схема |
|------|-------|
| `src/users/dto/create-user.dto.ts` | `UsersControllerCreateBody` (`{ name, email, username, password, role? }`) |
| `src/users/dto/update-user.dto.ts` | `UsersControllerUpdateBody` (`{ name?, email?, username?, role? }`) |
| `src/users/dto/change-password.dto.ts` | `UsersControllerChangePasswordBody` (`{ password }`) |
| `src/users/dto/find-all-users-query.dto.ts` | `UsersControllerFindAllQueryParams` + `.extend({ page: z.coerce.number().int().min(1).optional(), limit: z.coerce.number().int().min(1).max(100).optional() })` (findAll) |
| `src/users/dto/user-response.dto.ts` | `UsersControllerCreateResponse` (create/findOne/update) |
| `src/users/dto/user-list-response.dto.ts` | `UsersControllerFindAllResponse` (findAll) |

Роль в ответах обязательна (`zod.enum(['admin','moderator','user'])`), в create/update — опциональна (дефолт `'user'`).

> ⚠️ **Breaking change (спецификация 0.15.0):** `GET /users` больше не возвращает голый массив — ответ обёрнут в `{ users, count }` (`AllUsersResponse`), где `count` — общее число пользователей. Старые admin-клиенты, ожидающие массив, должны быть обновлены. Добавлены опциональные query `page`/`limit` (offset-пагинация, порядок `id DESC`).

## Связанные документы

- [README.md](./README.md) — индекс модулей
- [auth.md](./auth.md) — как `UsersService` используется в `signIn`/`getProfile`/refresh/auto-rehash
- [shared.md](./shared.md) — `IdParamDto`
- [../db.md](../db.md) — таблица `user` в схеме БД, миграция `002_add_user_roles.sql`
- [../conventions.md](../conventions.md) — note про legacy class-validator
- [../contracts/rest-api.md](../contracts/rest-api.md) — контракт `UsersController*` и матрица ролей
- Домен users на фронте и экраны управления пользователями — репозиторий `slovo-propovedi-admin`
