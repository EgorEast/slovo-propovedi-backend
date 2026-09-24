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
| `listOrphans(referenced, limit): Promise<StoredFile[]>` | до `limit` осиротевших медиа-объектов newest-first; стрим останавливается при достижении капа |
| `listAllFiles(): Promise<StoredFile[]>` | полный скан bucket (без капа, стриминг, newest-first) |
| `listFilesWithUsage(referenced): Promise<StoredFileUsage[]>` | полный скан + флаг `used` по переданным наборам referenced-имён |
| `getPresignedUrl(bucket, fileName, expiry=3600)` | presigned GET для произвольного bucket |
| `getPresignedFileUrl(fileName, expiry=3600)` | presigned GET в default bucket `files` |
| `extractFileNameFromUrl(fileUrl)` (static) | вытащить имя объекта из сохранённого URL |
| `getFileExtension(fileName)` (static) | нижний регистр расширения (с точкой); без точки — `''` |
| `isImageFile` / `isAudioOrTextFile` / `isMediaFile` (static) | классификация объекта по расширению |
| `removeObjectByUrl(fileUrl)` | удалить объект из default bucket `files` по сохранённому URL |
| `removeObjectByName(fileName)` | удалить объект из default bucket `files` по имени |
| `getContentType(fileType)` | ext → MIME (`image/*`, `audio/mp3`, иначе `application/octet-stream`) |

> Read-путь orphans ограничен: `listOrphans(referenced, limit)` стримит bucket и останавливается, как только собрано `limit` осиротевших объектов, — накопление ограничено `limit`, а не размером bucket (см. [`app.md`](./app.md)). Полный скан (`listAllFiles`/`listFilesWithUsage`) остаётся **без капа** для orphans-*cleanup*: чтобы удалить все осиротевшие аудио/текст, нужно перечислить весь bucket. Стрим `listObjectsV2` не материализует листинг целиком в памяти; собранный список копится в массиве — на каталоге админ-масштаба это дёшево.

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

- Сканирует bucket через общий приватный `scanBucket({ extensions, limit })` (стрим `listObjectsV2`), фильтрует по `IMAGE_EXTENSIONS` = `[.jpeg, .jpg, .png, .webp]`.
- Останавливает стрим при `IMAGE_LIMIT = 500` (ограничивает память на большом bucket).
- Сортирует newest-first по `lastModified`.
- Возвращает `StoredImage[]` = `{ fileName, fileUrl, size, lastModified }` (алиас `StoredFile`).

### `listOrphans` (ограниченный read-скан)

- Сканирует bucket через тот же приватный `scanBucket({ match, limit })`, но `match` классифицирует **на лету**: медиа-расширение И объект не входит в referenced-наборы.
- Стрим останавливается, как только собрано `limit` осиротевших объектов; referenced-объекты и объекты за капом не накапливаются — память ограничена `limit`, а не размером bucket. `scanBucket` держит `settled`-флаг, поэтому «хвостовой» `data`-эвент после `destroy()` не превышает кап.
- Возвращает `StoredFile[]` (newest-first). Используется `GET /files/orphans` (см. [`app.md`](./app.md)).

### `listAllFiles` / `listFilesWithUsage` (полный скан)

- `listAllFiles()` — весь bucket, без фильтра по расширению и без капа, newest-first; `StoredFile[]` = `{ fileName, fileUrl, size, lastModified }`.
- `listFilesWithUsage(referenced)` — тот же скан, каждый объект классифицируется по расширению и помечается `used`: изображения сверяются с `referenced.artwork`, аудио/текст — с `referenced.audio` + `referenced.text`; объекты вне медиа-таксономии никогда не помечаются `used`. Возвращает `StoredFileUsage[]` = `{ ..., used }`.
- Оба метода используют общий `scanBucket` без `limit` — стрим не материализует листинг в памяти целиком; собранный список копится в массиве.
- Полный скан нужен orphans-*cleanup* (`POST /files/orphans/cleanup`), чтобы удалить **все** осиротевшие аудио/текст; read-эндпоинт `GET /files/orphans` использует ограниченный `listOrphans`. Наборы referenced-имён строит контроллер из БД через `extractFileNameFromUrl`.

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

Извлекает имя объекта через `extractFileNameFromUrl` и вызывает `removeObject` на default bucket `files`. URL, чей путь не начинается с default bucket, бросает ошибку; **host не проверяется** (переживает смену домена `MINIO_PUBLIC_URI`) — вызывающий решает, проглатывать ли ошибку. Используется в `SermonService.remove` для best-effort очистки аудио **и текстового файла** после удаления проповеди: сбои очистки логируются как `WARN`, запрос не падает (см. [`sermon.md`](./sermon.md)).

### `removeObjectByName`

```ts
async removeObjectByName(fileName: string): Promise<void> {
  await this.minioClient.removeObject(MinioService.BUCKET_NAME, fileName);
}
```

Удаляет объект по имени (без разбора URL). Удаление несуществующего объекта — no-op (S3 DeleteObject идемпотентен). Используется `DELETE /files/:fileName` и `POST /files/orphans/cleanup`.

## Связанные документы

- [README.md](./README.md) — индекс модулей
- [app.md](./app.md) — файловые эндпоинты, использующие `MinioService`
- [sermon.md](./sermon.md) — presigned-URL аудио через `extractFileNameFromUrl`
- [../architecture.md](../architecture.md) — env (`MINIO_*`, `MINIO_PUBLIC_URI`), bucket на boot
- [../contracts/rest-api.md](../contracts/rest-api.md) — контракт загрузки файлов
