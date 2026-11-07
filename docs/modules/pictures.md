# Модуль `pictures` — BlurHash обложек

Хранит BlurHash-плейсхолдеры загруженных изображений: компактную строку, которую клиент показывает, пока грузится оригинал обложки. Значение считается при загрузке картинки через `POST /files` и лежит в таблице `picture`; наружу через HTTP не отдаётся.

**Слой:** backend (module `pictures`)
**Статус:** актуально

## Назначение

- Для каждого загруженного изображения (`.jpeg/.jpg/.png/.webp`) считается BlurHash и сохраняется вместе с именем объекта в бакете `files`.
- Строка дешёвая (несколько десятков байт), поэтому клиент может отдавать её до загрузки самой обложки и показывать размытую заглушку без отдельного запроса.
- Существующие картинки дозаполняются скриптом `npm run backfill-blurhash` (см. ниже).
- REST-контракт **не менялся**: blurhash не возвращается в ответах `POST /files`/`GET /files`, `FileResponseDto` остался прежним.

## Устройство

```
src/pictures/
├── pictures.module.ts             # TypeOrmModule.forFeature([PictureEntity]) + PicturesService (exported)
├── pictures.service.ts            # record / recordForUpload
├── blurhash.ts                    # encodeBlurhash / computeBlurhash
└── entities/picture.entity.ts     # PictureEntity (таблица picture)
```

`PicturesModule` подключается в `AppModule`; `PicturesService` экспортируется и внедряется в `AppController` (загрузка файлов).

### `PictureEntity` — таблица `picture`

`src/pictures/entities/picture.entity.ts`. Полная карта — в [`../db.md`](../db.md).

| Поле | Колонка | Тип | Примечание |
|------|---------|-----|------------|
| `id` | `id` | uuid | PK |
| `picturePath` | `picture-path` | varchar | NOT NULL, **UNIQUE** (`UQ_picture_picture_path`) — имя объекта в бакете `files` (`<uuid>.<ext>`) |
| `blurhash` | `blurhash` | varchar | nullable — BlurHash или `NULL`, если ещё не посчитан |

Уникальность `"picture-path"` — несущая: upsert-семантика сервиса опирается на «не более одной строки на объект».

### `PicturesService`

| Метод | Назначение |
|-------|------------|
| `record(picturePath, blurhash)` | upsert по `"picture-path"`: `findOne` → `save` (обновить `blurhash`) либо `insert` (новая строка). Без TypeORM-опций upsert, чтобы не зависеть от диалекта. |
| `recordForUpload(picturePath, image)` | best-effort: `computeBlurhash(image)` → `record(...)`. Любая ошибка вычисления или записи логируется (`Blurhash for <file> failed: ...`) и **не валит загрузку** — обложка остаётся рабочей, отсутствует только заглушка. |

`AppController.uploadFile` вызывает `recordForUpload` только для изображений (`MinioService.isImageFile(fileName)`), уже после сохранения объекта в MinIO. Ошибка не меняет ответ `POST /files`.

## Параметры хэширования

`computeBlurhash(image)` (`src/pictures/blurhash.ts`):

```ts
const { data, info } = await sharp(image)
  .rotate()            // применить EXIF-ориентацию (как у превью)
  .ensureAlpha()       // blurhash требует 4 канала (RGBA)
  .raw()
  .toBuffer({ resolveWithObject: true });

encode(new Uint8ClampedArray(data), info.width, info.height, 4, 3);
```

- `encode` — из пакета `blurhash`; компоненты **4×3** (`x = 4`, `y = 3`) зафиксированы в `encodeBlurhash`. Первый символ строки — size-flag `L` (`(4 − 1) + (3 − 1) × 9 = 21`, 21-й символ base83), по нему клиент понимает размер сетки.
- EXIF-ориентация применяется до чтения пикселей, поэтому заглушка соответствует тому, как клиент показывает оригинал.

## Бэкфилл существующих картинок

Скрипт `scripts/backfill-blurhash.mjs` (`npm run backfill-blurhash`):

- перечисляет бакет `files` рекурсивно и берёт только `.jpeg/.jpg/.png/.webp`;
- пропускает превью `thumbs/` (это производные изображения) и всё вне media-taxonomy;
- читает уже заполненные `picture.blurhash` и не пересчитывает их;
- **dry-run по умолчанию**: печатает `total / skipped / к вычислению` и ничего не скачивает и не пишет;
- с `--apply` последовательно скачивает объект, считает BlurHash и пишет upsert `INSERT ... ON CONFLICT ("picture-path") DO UPDATE SET blurhash = EXCLUDED.blurhash`; ошибки по объекту логируются и не прерывают обход.

Схема таблицы создаётся миграцией [`sql/migrations/016_add_picture.sql`](../../sql/migrations/016_add_picture.sql) (идемпотентна) и продублирована в `sql/bootstrap.sql` для свежих БД.

## Чего нет (пока)

- Нет HTTP-эндпоинтов модуля: `pictures` — внутренний сервис, наружу торчит только `POST /files`.
- BlurHash не возвращается в ответах API — `FileResponseDto`, сгенерированные zod-схемы и фронтенд-DTO не менялись.
- Нет удаления строк `picture` при удалении изображения (имена объектов неизменяемы, строки переживают удаление файла; отдельной очистки пока нет).

## Связанные документы

- [README.md](./README.md) — индекс модулей
- [app.md](./app.md) — `POST /files`, из которого вызывается `recordForUpload`
- [minio.md](./minio.md) — загрузка объекта, превью `thumbs/`, таксономия расширений
- [../db.md](../db.md) — таблица `picture` и ручные миграции
- [../../scripts/backfill-blurhash.mjs](../../scripts/backfill-blurhash.mjs) — бэкфилл существующих обложек
