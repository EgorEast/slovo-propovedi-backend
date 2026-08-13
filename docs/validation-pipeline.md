# Пайплайн валидации — OpenAPI-first

Проект использует подход **OpenAPI-first**: внешняя спецификация определяет контракт, а источник истины валидации на границе — **сгенерированные zod-схемы** (`src/generated/index.ts`), которые экспонируются через `createZodDto` DTO. Прозо-документация описывает контракт; решают схемы.

Спецификация живёт во **внешнем swagger-репозитории** `slovo-propovedi-docs` и публикуется по адресу `https://docs.slovo-propovedi.ru/openAPI.yaml`. В этом репозитории файла нет (gitignored, локально отсутствует). Версия спецификации не фиксируется — см. `info.version` внешнего `openAPI.yaml`.

## Рабочий процесс

1. **Редактирование спецификации** — изменения вносятся в `openAPI.yaml` репозитория `slovo-propovedi-docs` (внешний), затем публикуются по указанному URL.

2. **Регенерация zod-схем** — из корня этого репозитория:

   ```bash
   npm run gen:schemas
   ```

   Команда читает спецификацию по URL (через `scripts/gen-schemas.mjs`, Orval, конфиг `orval.config.mjs`) и генерирует zod-схемы в `src/generated/index.ts`. Эти схемы используются в `@ZodResponse()` и DTO контроллеров.

3. **CI-проверка свежести** — в CI проверяется, что сгенерированные схемы актуальны:

   ```bash
   npm run gen:schemas && git diff --exit-code -- src/generated/ || (echo "::error::Generated schemas are stale. Run: npm run gen:schemas" && exit 1)
   ```

   Если проверка падает — кто-то изменил спецификацию, но забыл перегенерировать схемы.

При изменении спецификации схемы регенерируются в этом репозитории (`npm run gen:schemas`); фронтенд-SDK регенерируется отдельно в своём репозитории (`slovo-propovedi-admin`). Сгенерированные файлы коммитятся вместе с кодом.

## Слои валидации

| Слой | Инструмент | Назначение |
|------|------------|------------|
| Входные данные (body/query/params) | `ZodValidationPipe` (strict) | Валидирует входящие данные против zod DTO; глобальный pipe (`useGlobalPipes`) с `strictSchemaDeclaration: true` |
| Сериализация ответов | `ZodSerializerInterceptor` + `@ZodResponse()` | Проверяет, что исходящие данные соответствуют спецификации |

`strictSchemaDeclaration: true` (в `src/main.ts`) требует, чтобы метатип каждого параметра маршрута был zod DTO — иначе глобальный pipe выбрасывает 500. Так ни одни невалидированные данные не проходят на границе.

## Связанные документы

- [./contracts/rest-api.md](./contracts/rest-api.md) — кодогенерация Orval и конвейер схем
- [./conventions.md](./conventions.md) — OpenAPI-first workflow, команды регенерации, DoD
- [./architecture.md](./architecture.md) — bootstrap, env, runtime
