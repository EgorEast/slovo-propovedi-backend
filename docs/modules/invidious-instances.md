# Модуль `invidious-instances` — источники импорта проповедей

Хранит админ-управляемый список Invidious-инстансов, которые мобильное приложение предлагает как пресеты в форме импорта проповеди. Список живёт на бэкенде (не хардкодится в клиенте) и полностью заменяется одним `PUT`.

**Слой:** backend (module `invidious-instances`)
**Статус:** актуально

> ⚠️ Оба эндпоинта — **admin-only** (`AuthGuard` + `RolesGuard` с `@Roles(UserRole.Admin)`): это конфигурация импорта, moderator к ней доступа не имеет.

## Эндпоинты

| Метод / путь | Guard | Body | DTO ответа | Метод сервиса |
|---------------|-------|------|------------|----------------|
| `GET /invidious-instances` | ✅ `AuthGuard` + `RolesGuard` (admin) | — | `[InvidiousInstanceDto]` (голый массив) | `findAll()` |
| `PUT /invidious-instances` | ✅ `AuthGuard` + `RolesGuard` (admin) | `ReplaceInvidiousInstancesDto` (`{ urls: string[] }`) | `[InvidiousInstanceDto]` (голый массив) | `replace(urls)` |

`@Controller('invidious-instances')` (`src/invidious-instances/invidious-instances.controller.ts`).

> ✅ Оба роута отвечают **голым JSON-массивом** `InvidiousInstance[]` (без обёртки `{ items, count }`, в отличие от `/users`, `/sermons`). Это зафиксировано в спецификации (`type: array` в ответе) и поддержано nestjs-zod формой `@ZodResponse({ type: [InvidiousInstanceDto] })`.

## Сущность `InvidiousInstanceEntity` (`src/invidious-instances/entities/invidious-instance.entity.ts`)

Таблица `invidious_instance` (`@Entity('invidious_instance')`).

| Поле | Колонка | Тип | Ограничения |
|------|---------|-----|-------------|
| `id` | `id` | integer | PK, автоинкремент (`@PrimaryGeneratedColumn()`, `serial`) |
| `url` | `url` | varchar | UNIQUE, полный `https://`-адрес |

> ✅ `id` — **не uuid**, а автоинкрементный integer: клиент использует его лишь как стабильный ключ списка, а возрастающий порядок id одновременно служит порядком отображения (см. `replace`). Дубликаты `url` запрещены на уровне БД (UNIQUE) и валидации сервиса.

## `InvidiousInstancesService` (`src/invidious-instances/invidious-instances.service.ts`)

| Метод | Назначение |
|-------|------------|
| `findAll()` | `repository.find({ order: { id: 'ASC' } })` — список в порядке отображения |
| `replace(urls)` | полная замена в одной транзакции (см. ниже) |
| `onModuleInit()` | сидирование (см. ниже) |

### Полная замена (`replace`)

1. **Валидация до БД**: дубликаты → `400 Bad Request` («Дубликаты Invidious-инстансов запрещены»); адрес без префикса `https://` → `400` («Адрес должен начинаться с https://…»). Пустой массив допустим (полная замена «ничем»).
2. **Транзакция**: `repository.clear()` (TRUNCATE) + `save(urls.map(create))`. Сущность не имеет колонки `position`, поэтому единственный способ сохранить запрошенный порядок (= порядок в UI) — переписать все строки; id остаются возрастающими и повторяют порядок массива.

> ⚠️ Полная замена переписывает все строки, поэтому `id` меняются при каждом `PUT`. Для клиента это неважно (id — только React-ключ); если понадобится стабильность id, потребуется колонка `position` и diff-обновление.

### Сидирование

На `onModuleInit`, **если таблица пуста**, вставляются два проверенных инстанса:

- `https://inv.phobos.observer`
- `https://invidious.f5.si`

(проверены 2026-10-05 через пробу `/api/v1/videos`; константа `SEED_URLS` с этим комментарием в сервисе).

> ✅ Сидирование **best-effort**: ошибка БД на старте логируется как warning и не роняет bootstrap. Если админ сохранил пустой список, после рестарта таблица снова засеется дефолтами.

## DTO

| Файл | Схема |
|------|-------|
| `src/invidious-instances/dto/invidious-instance.dto.ts` | `InvidiousInstancesControllerFindAllResponseItem` (`{ id: integer, url: string }`) |
| `src/invidious-instances/dto/replace-invidious-instances.dto.ts` | `InvidiousInstancesControllerReplaceBody` (`{ urls: string[] }`) |

## Связанные документы

- [README.md](./README.md) — индекс модулей
- [../db.md](../db.md) — таблица `invidious_instance`, миграция `008_add_invidious_instances.sql`
- [../contracts/rest-api.md](../contracts/rest-api.md) — контракт `InvidiousInstancesController*` и матрица ролей
- Мобильная форма импорта (потребляет пресеты) — репозиторий `slovo-propovedi-mobile`
