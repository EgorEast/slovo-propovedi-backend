# Модуль `shared` — общие DTO и сгенерированные схемы

Общие переиспользуемые DTO и указатель на сгенерированный код. Не HTTP-модуль.

**Слой:** backend (module `shared`)
**Статус:** актуально

## Общие DTO

### `IdParamDto` (`src/shared/dto/id-param.dto.ts`)

Параметр пути `:id`, валидируется как uuid:

```ts
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export class IdParamDto extends createZodDto(
  z.object({ id: z.string().uuid() }),
) {}
```

Используется во всех `GET/PATCH/DELETE /:id` эндпоинтах (`sermon`, `playlist`, `section`, files-stream). См. [`app.md`](./app.md), [`sermon.md`](./sermon.md), [`playlist.md`](./playlist.md), [`section.md`](./section.md).

### `FileNameParamDto` (`src/shared/dto/file-name-param.dto.ts`)

Параметр пути `:fileName` (имя объекта в MinIO):

```ts
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export class FileNameParamDto extends createZodDto(
  z.object({ fileName: z.string() }),
) {}
```

Используется в `GET /files/:fileName` и `GET /files/:fileName/stream-url` ([`app.md`](./app.md)).

## Сгенерированные схемы: `generated/index.ts`

> ⚠️ **`src/generated/index.ts` — генерируется, не редактируется руками.** Это выход Orval (`npm run gen:schemas`) из внешней OpenAPI-спецификации (`https://docs.slovo-propovedi.ru/openAPI.yaml`).

- Файл: `src/generated/index.ts` (~1650 строк).
- Содержит zod-схемы: `SermonController*`, `PlaylistController*`, `SectionController*`, `AppController*`, `HealthController*`, `AuthController*`, `GetFilesResponse`, и т.д.
- Особенности эмиссии: `zod.strictObject` (лишние ключи отбраковываются), `zod.uuid()`, enums, `.default()` для response-boolean, union-тип для `verse`.
- DTO-наследники (`createZodDto(<generated schema>)`) живут в `src/<module>/dto/` — см. [`../conventions.md`](../conventions.md).

```bash
npm run gen:schemas   # регенерация + prettier
```

Полный конвейер кодогенерации — в [`../contracts/rest-api.md`](../contracts/rest-api.md).

## Связанные документы

- [README.md](./README.md) — индекс модулей
- [app.md](./app.md) — `FileNameParamDto` в файловых эндпоинтах
- [../conventions.md](../conventions.md) — extend/override DTO поверх сгенерированных схем
- [../contracts/rest-api.md](../contracts/rest-api.md) — конвейер кодогенерации Orval
