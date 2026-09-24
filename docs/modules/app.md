# Модуль `app` — файловое хранилище

Корневой модуль (`src/app.module.ts`) регистрирует всё приложение; контроллер `AppController` (`src/app.controller.ts`, без префикса) отвечает за **файлы**: загрузку в MinIO и выдачу URL. Бизнес-логика хранилища — в [`minio.md`](./minio.md); сам контроллер — тонкий: валидирует расширение, вызывает `MinioService`, декорирует ответ `@ZodResponse`.

**Слой:** backend (module `app`)
**Статус:** актуально

## Эндпоинты

| Метод / путь | Guard | DTO ответа | Метод сервиса | Назначение |
|---------------|-------|------------|----------------|------------|
| `POST /files` | ✅ `AuthGuard` + `RolesGuard` (admin, moderator) | `FileResponseDto` | `uploadFile` → MinIO | загрузка файла (multipart, поле `file`) |
| `GET /files` | ✅ `AuthGuard` + `RolesGuard` (admin, moderator) | `GetFilesResponseDto` | `listImages` → MinIO | список изображений для обложек (cover-reuse), каждый с флагом `used` |
| `GET /files/orphans` | ✅ `AuthGuard` + `RolesGuard` (admin, moderator) | `OrphanedFilesResponseDto` | `listOrphans` → MinIO | список осиротевших медиа-объектов (не привязаны к проповедям/плейлистам); query `limit?` (default 500, max 5000) |
| `POST /files/orphans/cleanup` | ✅ `AuthGuard` + `RolesGuard` (admin, moderator) | `CleanupOrphansResponseDto` | `listFilesWithUsage` + `removeObjectByName` → MinIO | идемпотентная очистка **только** осиротевших аудио/текстовых объектов (`.mp3/.pdf/.fb2`) |
| `GET /files/:fileName` | публичный | `FileResponseDto` | `getFileUrl` | статический (non-expiring) URL **deprecated** |
| `GET /files/:fileName/stream-url` | публичный | `StreamUrlResponseDto` | `getPresignedFileUrl` | time-limited presigned URL |
| `DELETE /files/:fileName` | ✅ `AuthGuard` + `RolesGuard` (admin, moderator) | `StatusFileResponseDto` | `removeObjectByName` → MinIO | удаление объекта-изображения; `409`, если изображение используется как обложка |

> ⚠️ **Порядок маршрутов важен.** Статические сегменты объявлены **до** параметрических: `GET /files`/`GET /files/orphans` — до `GET /files/:fileName`, иначе `files`/`orphans` были бы проглочены как `:fileName` (Express матчит роуты по порядку).

## `POST /files` — загрузка

```ts
@Post('files')
@Roles(UserRole.Admin, UserRole.Moderator)
@UseGuards(AuthGuard, RolesGuard)
@ZodResponse({ type: FileResponseDto })
@UseInterceptors(FileInterceptor('file'))
async uploadFile(@UploadedFile('file') file: FileUploadDto): Promise<FileResponseDto>
```

- Multipart-поле `file`, перехватывается `FileInterceptor('file')`.
- **Allow-list расширений** проверяется в контроллере **до** попадания файла в хранилище:
  `.jpeg .jpg .png .webp .mp3 .pdf .fb2`. Иное расширение → `BadRequestException` («Недопустимый тип файла…»).
- Параметр аннотирован `FileUploadDto` (`createZodDto(z.any())`) — passthrough для `Express.Multer.File`, нужен только чтобы удовлетворить strict-пайп (см. [`../conventions.md`](../conventions.md)).
- Вызывает `minioService.uploadFile(multerFile)` (имя файла = `randomUUID() + ext`), затем `getFileUrl` → `{ fileName, fileUrl }`.

## `GET /files` — список изображений (cover-reuse)

```ts
@Get('files')
@Roles(UserRole.Admin, UserRole.Moderator)
@UseGuards(AuthGuard, RolesGuard)
@ZodResponse({ type: GetFilesResponseDto })
async listFiles(): Promise<GetFilesResponseDto>
```

- Защищён (`AuthGuard` + `RolesGuard`, роли admin/moderator) — инвентарь хранилища не должен быть доступен неаутентифицированным и обычным `user`.
- Возвращает `minioService.listImages()` (до 500 изображений, newest-first) как `{ files: [...], count }`.
- Каждый элемент обогащён флагом `used` — изображение уже привязано как обложка (artwork) проповеди или плейлиста. Набор referenced-имён строится из БД (`loadReferencedFileNames()`: колонки `sermon.audioUrl/textFileUrl/artwork` + `playlist.artwork`, имена извлекаются через `MinioService.extractFileNameFromUrl`).

## `GET /files/orphans` — список осиротевших файлов

```ts
@Get('files/orphans')
@Roles(UserRole.Admin, UserRole.Moderator)
@UseGuards(AuthGuard, RolesGuard)
@ZodResponse({ type: OrphanedFilesResponseDto })
async getOrphanedFiles(@Query() query: FindOrphansQueryDto): Promise<OrphanedFilesResponseDto>
```

- Ограниченный скан bucket через `minioService.listOrphans(referenced, query.limit)`: стрим `listObjectsV2` классифицирует объекты **на лету** и останавливается, как только собрано `limit` осиротевших файлов. Ни referenced-объекты, ни объекты за капом не накапливаются — память ограничена `limit`, а не размером bucket.
- Query `limit` — необязательный, `1..5000`, по умолчанию `500` (`FindOrphansQueryDto`: coerce string→number + резолв дефолта из сгенерированных констант). Ответ `{ orphaned: FileMetadataDto[], count }`, `count === orphaned.length`; у каждого элемента `used: false` по определению.
- Осиротевшими считаются медиа-объекты, не привязанные к БД: аудио/текст (`.mp3/.pdf/.fb2`), не привязанные к `sermon.audioUrl/textFileUrl`, плюс изображения (`.jpeg/.jpg/.png/.webp`), не привязанные к artwork. Набор referenced-имён строит `loadReferencedFileNames()` из БД.
- Порядок — newest-first (как у `listImages`), поэтому при усечении до `limit` в ответе остаются самые свежие осиротевшие объекты из просмотренной части bucket.

## `POST /files/orphans/cleanup` — очистка осиротевших аудио/текста

```ts
@Post('files/orphans/cleanup')
@Roles(UserRole.Admin, UserRole.Moderator)
@UseGuards(AuthGuard, RolesGuard)
@ZodResponse({ type: CleanupOrphansResponseDto })
async cleanupOrphanedFiles(): Promise<CleanupOrphansResponseDto>
```

- Та же классификация, что в `GET /files/orphans`, но удаляются **только** осиротевшие аудио/текстовые объекты (`removeObjectByName`, best-effort). **Изображения не удаляются никогда** — обложками управляют вручную из каталога.
- Очистка намеренно сканирует **весь** bucket через `listFilesWithUsage(referenced)` (без капа): чтобы удалить *все* осиротевшие аудио/текст, нужно перечислить весь bucket. Это редкая admin-операция, а не read-путь, поэтому ограничение `limit` к ней не применяется (read-эндпоинт выше ограничен).
- Ошибка удаления отдельного объекта не роняет запрос: объект попадает в `failed` с `reason`, остальные продолжают удаляться. Ответ `{ deleted: string[], failed: { fileName, reason }[] }`. Идемпотентен: повторный вызов не найдёт уже удалённых объектов (S3 DeleteObject идемпотентен).

## `DELETE /files/:fileName` — удаление изображения

```ts
@Delete('files/:fileName')
@Roles(UserRole.Admin, UserRole.Moderator)
@UseGuards(AuthGuard, RolesGuard)
@ZodResponse({ type: StatusFileResponseDto })
async removeFile(@Param() params: FileNameParamDto)
```

- Только изображения: не-image расширение → `400 Bad Request` (аудио/текст удаляются через orphans/cleanup).
- Если имя совпадает с artwork какой-либо проповеди или плейлиста (сравнение извлечённых имён объектов) → `409 Conflict` с понятным сообщением. Обложки управляются вручную и не должны исчезать под админом.
- Иначе `removeObjectByName(fileName)` → `{ status: 'success' }`. Существование объекта не проверяется — S3 DeleteObject идемпотентен.

## `GET /files/:fileName` — статический URL

```ts
@Get('files/:fileName')
@ZodResponse({ type: FileResponseDto })
async getFile(@Param() params: FileNameParamDto)
```

- Возвращает `{ fileName, fileUrl }`, где `fileUrl = ${MINIO_PUBLIC_URI}/files/<name>`.
- **Deprecated** (JSDoc в коде): статический URL не истекает, а bucket приватный по умолчанию. Предпочтителен `stream-url`.

## `GET /files/:fileName/stream-url` — presigned URL

```ts
@Get('files/:fileName/stream-url')
@ZodResponse({ type: StreamUrlResponseDto })
async getStreamUrl(@Param() params: FileNameParamDto)
```

- Вызывает `minioService.getPresignedFileUrl(fileName)` → `{ url }` (time-limited, по умолчанию 3600 с).
- Аудио/видео отдаётся напрямую из MinIO, а не проксируется через backend (проксирование держало бы буферы в Node heap).

> ✅ Публичный `GET /files/:fileName*` — **только** для чтения уже сохранённых объектов через публичный bucket URL; список и загрузка защищены.

## DTO

| Файл | Схема |
|------|-------|
| `src/app/dto/file-upload.dto.ts` | `createZodDto(z.any())` — passthrough Multer |
| `src/app/dto/file-response.dto.ts` | `AppControllerUploadFileResponse` (`{ fileName, fileUrl }`) |
| `src/app/dto/get-files-response.dto.ts` | `GetFilesResponse` (`{ files[], count }`, элементы с `used`) |
| `src/app/dto/find-orphans-query.dto.ts` | `AppControllerGetOrphanedFilesQueryParams` + `.extend({ limit: z.coerce.number().int().min(1).max(5000).default(500) })` — query `limit?` |
| `src/app/dto/orphaned-files-response.dto.ts` | `AppControllerGetOrphanedFilesResponse` (`{ orphaned[], count }`) |
| `src/app/dto/cleanup-orphans-response.dto.ts` | `AppControllerCleanupOrphanedFilesResponse` (`{ deleted[], failed[] }`) |
| `src/app/dto/status-file-response.dto.ts` | `AppControllerRemoveFileResponse` (`{ status }`) |
| `src/app/dto/stream-url-response.dto.ts` | `AppControllerGetStreamUrlResponse` (`{ url }`) |

Все DTO — наследники `createZodDto(...)` от сгенерированных схем (`generated/index.ts`).

## Связанные документы

- [README.md](./README.md) — индекс модулей
- [minio.md](./minio.md) — `MinioService`: bucket `files`, upload, presign, public-read
- [shared.md](./shared.md) — `FileNameParamDto`
- [../architecture.md](../architecture.md) — bootstrap, CORS, глобальные механизмы
- [../contracts/rest-api.md](../contracts/rest-api.md) — контракт `AppController*`
