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

Используется во всех `GET/PATCH/DELETE /:id` эндпоинтах (`sermon`, `playlist`, `section`). См. [`app.md`](./app.md), [`sermon.md`](./sermon.md), [`playlist.md`](./playlist.md), [`section.md`](./section.md).

### `FileNameParamDto` (`src/shared/dto/file-name-param.dto.ts`)

Параметр пути `:fileName` (имя объекта в MinIO). Хранимые имена — всегда `randomUUID() + <media extension>`, поэтому DTO принимает **только** такую форму:

```ts
const FileNameParamSchema = AppControllerGetFileParams.extend({
  fileName: z.string().max(255).regex(STORED_FILE_NAME_PATTERN),
});
export class FileNameParamDto extends createZodDto(FileNameParamSchema) {}
```

- `STORED_FILE_NAME_PATTERN` (`src/shared/media.ts`) — `^<uuid>\.(jpeg|jpg|png|webp|mp3|m4a|pdf|fb2)$`, case-insensitive; альтернация расширений **выводится** из `MEDIA_EXTENSIONS`, не копируется вручную.
- Сгенерированная схема `AppControllerGetFileParams` расширяется (не переписывается); strict-объект наследуется.
- Отклоняет произвольные строки, path traversal (`../../x`, URL-encoded варианты), неизвестные расширения и лишние ключи — `400` до вызова MinIO.
- Используется в `GET /files/:fileName` и `DELETE /files/:fileName` ([`app.md`](./app.md)).

### `media.ts` (`src/shared/media.ts`)

Единый источник истины таксономии медиа: `IMAGE_EXTENSIONS`, `AUDIO_EXTENSIONS`, `TEXT_EXTENSIONS`, `AUDIO_TEXT_EXTENSIONS` (объединение двух предыдущих), `MEDIA_EXTENSIONS`, `getFileExtension()`, `STORED_FILE_NAME_PATTERN`. Из него выводятся upload allow-list (`src/app/upload-file-filter.ts`), classification бакета (`MinioService`) и валидация `:fileName` — добавили формат в одном месте, обновились все три.

### `internal-error.ts` (`src/shared/internal-error.ts`)

Единый контракт для непредвиденных ошибок сервисов:

```ts
toInternalServerError(logger, operation, error): InternalServerErrorException
```

- Пишет полный `error.message` + stack в серверный лог через `Logger.error` с префиксом `from:<operation>` (correlation context).
- Возвращает `InternalServerErrorException('Internal server error')` — тело ответа не содержит SQL, имён relation/constraint'ов и stack trace (finding AUTH M-3).
- Используется в `users`, `sermon`, `playlist`, `section`, `feature-flags`, `invidious-instances`; клиентские 4xx (`404`/`409`/`403`) пробрасываются до хелпера и не маскируются.

### `SortOrder` (`src/shared/sort.ts`)

Общий тип направления сортировки списков:

```ts
export type SortOrder = 'asc' | 'desc';
```

Направление резолвится на границе DTO (`.transform`) к документированному дефолту: `desc` для сортировки по дате/id, `asc` для алфавитных сортировок (`title`/`artist`/`playlist`/`section`); сервис никогда не видит неразрешённое направление. Используется в `find-all-sermons-query.dto.ts` и `find-all-playlists-query.dto.ts` (см. [`sermon.md`](./sermon.md), [`playlist.md`](./playlist.md)).

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
- [minio.md](./minio.md) — таксономия медиа в storage-слое
