# Модуль `app` — файловое хранилище

Корневой модуль (`src/app.module.ts`) регистрирует всё приложение; контроллер `AppController` (`src/app.controller.ts`, без префикса) отвечает за **файлы**: загрузку в MinIO и выдачу URL. Бизнес-логика хранилища — в [`minio.md`](./minio.md); сам контроллер — тонкий: валидирует расширение, вызывает `MinioService`, декорирует ответ `@ZodResponse`.

**Слой:** backend (module `app`)
**Статус:** актуально

## Эндпоинты

| Метод / путь | Guard | DTO ответа | Метод сервиса | Назначение |
|---------------|-------|------------|----------------|------------|
| `POST /files` | ✅ `AuthGuard` | `FileResponseDto` | `uploadFile` → MinIO | загрузка файла (multipart, поле `file`) |
| `GET /files` | ✅ `AuthGuard` | `GetFilesResponseDto` | `listImages` → MinIO | список изображений для обложек (cover-reuse) |
| `GET /files/:fileName` | публичный | `FileResponseDto` | `getFileUrl` | статический (non-expiring) URL **deprecated** |
| `GET /files/:fileName/stream-url` | публичный | `StreamUrlResponseDto` | `getPresignedFileUrl` | time-limited presigned URL |

> ⚠️ **Порядок маршрутов важен.** `GET /files` объявлен **до** `GET /files/:fileName` (Express матчит роуты по порядку) — иначе `files` был бы проглочен как `:fileName`.

## `POST /files` — загрузка

```ts
@Post('files')
@UseGuards(AuthGuard)
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
@UseGuards(AuthGuard)
@ZodResponse({ type: GetFilesResponseDto })
async listFiles(): Promise<GetFilesResponseDto>
```

- Защищён (`AuthGuard`) — инвентарь хранилища не должен быть доступен неаутентифицированным.
- Возвращает `minioService.listImages()` (до 500 изображений, newest-first) как `{ files: [...], count }`.

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
| `src/app/dto/get-files-response.dto.ts` | `GetFilesResponse` (`{ files[], count }`) |
| `src/app/dto/stream-url-response.dto.ts` | `AppControllerGetStreamUrlResponse` (`{ url }`) |

Все DTO — наследники `createZodDto(...)` от сгенерированных схем (`generated/index.ts`).

## Связанные документы

- [README.md](./README.md) — индекс модулей
- [minio.md](./minio.md) — `MinioService`: bucket `files`, upload, presign, public-read
- [shared.md](./shared.md) — `FileNameParamDto`
- [../architecture.md](../architecture.md) — bootstrap, CORS, глобальные механизмы
- [../contracts/rest-api.md](../contracts/rest-api.md) — контракт `AppController*`
