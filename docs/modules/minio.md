# Модуль `minio` — объектное хранилище

Обёртка над MinIO (`src/minio/minio.service.ts`). Отвечает за bucket `files`, два клиента (data-plane + presign), загрузку, presigned-URL и public-read policy. Используется bootstrap-ом (`createBucketIfNotExists`), модулями `app` (файлы) и `sermon` (presigned-URL аудио).

**Слой:** backend (module `minio`)
**Статус:** актуально

## Два клиента

`MinioService` держит два клиента MinIO:

| Клиент | Поле | Endpoint | Назначение |
|--------|------|----------|------------|
| внутренний (data-plane) | `minioClient` | `MINIO_ENDPOINT` + `MINIO_MAIN_PORT_IN`, `useSSL: false` | загрузка и администрирование bucket'а (Docker-сеть) |
| presign | `presignClient` | `MINIO_PUBLIC_URI` (host/port/useSSL из URI), region `us-east-1` | генерация presigned-URL для браузера |

> ✅ `buildPresignClient` кидает ошибку, если `MINIO_PUBLIC_URI` не задан (или невалидный URL). Причина двух клиентов — **SigV4**: host входит в подпись, поэтому presigned-URL должен генерироваться с тем же host, что увидит браузер; менять host после генерации нельзя.

## Bucket и policy

- **Имя bucket:** `MinioService.BUCKET_NAME = 'files'` (статическая константа).
- `createBucketIfNotExists()` — если bucket не существует, `makeBucket('files', 'us-east-1')`; затем `applyPublicReadPolicy()`.
- `applyPublicReadPolicy()` — политика, дающая **только** `s3:GetObject` на `files/*` для `Principal: '*'`:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PublicReadGetObject",
      "Effect": "Allow",
      "Principal": "*",
      "Action": ["s3:GetObject"],
      "Resource": ["arn:aws:s3:::files/*"]
    }
  ]
}
```

> ⚠️ Policy применяется **на каждом старте** (`setBucketPolicy` идемпотентен) — существующий bucket, созданный приватным, само-восстанавливается. Выдаётся **только** `s3:GetObject`; upload/list/delete остаются под MinIO-кредами.

## Публичные методы

| Метод | Назначение |
|-------|------------|
| `createBucketIfNotExists()` | обеспечить bucket + public-read (вызывается в `main.ts` на boot) |
| `uploadFile(file): Promise<string>` | сохраняет файл как `randomUUID() + ext` с content-type; возвращает `fileName` |
| `getFileUrl(fileName): Promise<string>` | `\`${MINIO_PUBLIC_URI}/files/<name>\`` (статический URL) |
| `listImages(): Promise<StoredImage[]>` | до 500 изображений (jpeg/jpg/png/webp) newest-first для обложек |
| `getPresignedUrl(bucket, fileName, expiry=3600)` | presigned GET для произвольного bucket |
| `getPresignedFileUrl(fileName, expiry=3600)` | presigned GET в default bucket `files` |
| `extractFileNameFromUrl(fileUrl)` (static) | вытащить имя объекта из сохранённого URL |
| `removeObjectByUrl(fileUrl)` | удалить объект из default bucket `files` по сохранённому URL |
| `getContentType(fileType)` | ext → MIME (`image/*`, `audio/mp3`, иначе `application/octet-stream`) |

### `uploadFile`

```ts
const fileType = path.extname(file.originalname);
const contentType = this.getContentType(fileType);
const fileName = randomUUID() + fileType;
await this.minioClient.putObject(BUCKET_NAME, fileName, file.buffer, file.size, {
  'Content-Type': contentType,
});
return fileName;
```

> ✅ Имя объекта = `randomUUID() + ext` — уникально, без коллизий от оригинальных имён.

### `listImages` (cover-reuse)

- Сканирует bucket (`listObjectsV2`), фильтрует по расширению `[.jpeg, .jpg, .png, .webp]`.
- Останавливает стрим при `IMAGE_LIMIT = 500` (ограничивает память на большом bucket).
- Сортирует newest-first по `lastModified`.
- Возвращает `StoredImage[]` = `{ fileName, fileUrl, size, lastModified }`.

### `getPresignedFileUrl`

```ts
async getPresignedFileUrl(fileName, expirySeconds = 3600) {
  return await this.getPresignedUrl(BUCKET_NAME, fileName, expirySeconds);
}
```

Стриминг отдаётся напрямую из MinIO (не через backend) — проксирование держало бы буферы в Node heap.

### `extractFileNameFromUrl`

```ts
static extractFileNameFromUrl(fileUrl: string): string {
  // pathname сегменты; путь ДОЛЖЕН начинаться с bucket 'files', имя объекта — после него
  // throws, если путь не начинается с default bucket или не содержит имени объекта
}
```

Проверяется **только путь**: он должен начинаться с default bucket (`files`); **host не проверяется** — сохранённые URL переживают смену домена `MINIO_PUBLIC_URI`. URL, чей путь не начинается с bucket (например, `https://cdn.example.com/podcast/files/ep1.mp3`), бросает ошибку — иначе чужой путь мог бы удалить объект из НАШЕГО bucket.

Используется в `SermonService.getStreamUrl`, чтобы из `sermon.audioUrl` получить имя объекта, и внутри `removeObjectByUrl` (см. ниже).

### `removeObjectByUrl`

```ts
async removeObjectByUrl(fileUrl: string): Promise<void> {
  const fileName = MinioService.extractFileNameFromUrl(fileUrl);
  await this.minioClient.removeObject(MinioService.BUCKET_NAME, fileName);
}
```

Извлекает имя объекта через `extractFileNameFromUrl` и вызывает `removeObject` на default bucket `files`. URL, чей путь не начинается с default bucket, бросает ошибку; **host не проверяется** (переживает смену домена `MINIO_PUBLIC_URI`) — вызывающий решает, проглатывать ли ошибку. Используется в `SermonService.remove` для best-effort очистки аудио после удаления проповеди: сбои очистки логируются как `WARN`, запрос не падает (см. [`sermon.md`](./sermon.md)).

## Связанные документы

- [README.md](./README.md) — индекс модулей
- [app.md](./app.md) — файловые эндпоинты, использующие `MinioService`
- [sermon.md](./sermon.md) — presigned-URL аудио через `extractFileNameFromUrl`
- [../architecture.md](../architecture.md) — env (`MINIO_*`, `MINIO_PUBLIC_URI`), bucket на boot
- [../contracts/rest-api.md](../contracts/rest-api.md) — контракт загрузки файлов
