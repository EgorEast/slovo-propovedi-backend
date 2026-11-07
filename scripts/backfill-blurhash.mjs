#!/usr/bin/env node

/**
 * Backfills BlurHash placeholders for images that are already stored in MinIO
 * but have no row (or a NULL blurhash) in the `picture` table. Covers the
 * existing catalogue: new uploads are recorded on the fly by
 * PicturesService.recordForUpload.
 *
 * It is DRY-RUN by default: it prints how many pictures still need a BlurHash
 * and only downloads/computes/writes with --apply. Idempotent — pictures whose
 * blurhash is already set are skipped.
 *
 * Run `node scripts/backfill-blurhash.mjs --help` for the usage in Russian.
 */

import { Client as PgClient } from 'pg';
import * as Minio from 'minio';
import sharp from 'sharp';
import { encode } from 'blurhash';

// Keep in sync with MinioService.BUCKET_NAME (src/minio/minio.service.ts).
const BUCKET_NAME = 'files';

// Keep in sync with IMAGE_EXTENSIONS (src/shared/media.ts). Only originals are
// backfilled; previews under `thumbs/` are generated images.
const IMAGE_EXTENSIONS = ['.jpeg', '.jpg', '.png', '.webp'];
const THUMBNAIL_PREFIX = 'thumbs/';

// Matches PicturesService / computeBlurhash (src/pictures/blurhash.ts).
const COMPONENT_X = 4;
const COMPONENT_Y = 3;

const UPSERT_SQL = `
  INSERT INTO picture ("picture-path", blurhash)
  VALUES ($1, $2)
  ON CONFLICT ("picture-path") DO UPDATE SET blurhash = EXCLUDED.blurhash
`;

const USAGE = `
Бэкфилл BlurHash для уже загруженных картинок (таблица picture).

По умолчанию выполняется DRY-RUN: печатает, сколько картинок нужно
посчитать, ничего не скачивает и не записывает.

Использование:
  npm run backfill-blurhash [флаги]
  node --env-file-if-exists=.env scripts/backfill-blurhash.mjs [флаги]

Флаги:
  --apply              скачать картинки, посчитать BlurHash и записать в picture
  -h, --help           показать эту справку

Что обрабатывается:
  объекты бакета «files» с расширением .jpeg/.jpg/.png/.webp. Превью в
  префиксе thumbs/ и файлы вне media-taxonomy пропускаются. Картинки, у
  которых blurhash уже заполнен в БД, повторно не считаются.

Переменные окружения (как в src/db/typeorm.module.ts и
src/minio/minio.service.ts):
  POSTGRES_HOST, POSTGRES_PORT, POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB
  MINIO_ENDPOINT, MINIO_MAIN_PORT_IN, MINIO_ACCESS_KEY, MINIO_SECRET_KEY
`;

function parseArgs(argv) {
  const args = { apply: false };
  for (const arg of argv) {
    if (arg === '--apply') {
      args.apply = true;
    } else if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg.startsWith('-')) {
      throw new Error(`Неизвестный флаг: ${arg}`);
    } else {
      throw new Error(`Лишний аргумент: ${arg}`);
    }
  }
  return args;
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Переменная окружения ${name} не задана.`);
  }
  return value;
}

function createPgClient() {
  return new PgClient({
    host: requireEnv('POSTGRES_HOST'),
    port: Number(requireEnv('POSTGRES_PORT')),
    user: requireEnv('POSTGRES_USER'),
    password: requireEnv('POSTGRES_PASSWORD'),
    database: requireEnv('POSTGRES_DB'),
  });
}

function createMinioClient() {
  return new Minio.Client({
    endPoint: requireEnv('MINIO_ENDPOINT'),
    port: Number(requireEnv('MINIO_MAIN_PORT_IN')),
    useSSL: false,
    accessKey: requireEnv('MINIO_ACCESS_KEY'),
    secretKey: requireEnv('MINIO_SECRET_KEY'),
  });
}

function getFileExtension(fileName) {
  const dotIndex = fileName.lastIndexOf('.');
  return dotIndex === -1 ? '' : fileName.slice(dotIndex).toLowerCase();
}

function isImageFile(fileName) {
  return IMAGE_EXTENSIONS.includes(getFileExtension(fileName));
}

// Recursive whole-bucket scan. Thumbnails are previews of originals and every
// non-image (audio/text) object is outside the picture taxonomy.
async function listImageObjects(minioClient) {
  const names = [];
  for await (const object of minioClient.listObjectsV2(BUCKET_NAME, '', true)) {
    const name = object.name;
    if (!name || name.startsWith(THUMBNAIL_PREFIX) || !isImageFile(name)) {
      continue;
    }
    names.push(name);
  }
  return names;
}

async function loadComputedPicturePaths(pgClient) {
  const { rows } = await pgClient.query(
    'SELECT "picture-path", blurhash FROM picture WHERE blurhash IS NOT NULL',
  );
  return new Set(rows.map((row) => row['picture-path']));
}

async function downloadObject(minioClient, objectName) {
  const stream = await minioClient.getObject(BUCKET_NAME, objectName);
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function computeBlurhash(image) {
  const { data, info } = await sharp(image)
    .rotate()
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return encode(
    new Uint8ClampedArray(data),
    info.width,
    info.height,
    COMPONENT_X,
    COMPONENT_Y,
  );
}

function printSummary({ apply, total, skipped, computed, failed, pending }) {
  console.log('');
  console.log(
    apply ? '📊 Итог (записано):' : '📊 Итог (dry-run, ничего не записано):',
  );
  console.log(
    `   картинки: всего ${total}, пропущено ${skipped}, вычислено ${computed}, ошибок ${failed}`,
  );
  if (!apply) {
    console.log(`   к вычислению: ${pending}`);
    console.log('');
    console.log('   Для записи повторите с --apply.');
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(USAGE);
    return;
  }

  const pgClient = createPgClient();
  const minioClient = createMinioClient();

  try {
    await pgClient.connect();
    console.log(
      `🐘 PostgreSQL: ${process.env.POSTGRES_DB}@${process.env.POSTGRES_HOST}`,
    );
    console.log(`🪣 MinIO: ${process.env.MINIO_ENDPOINT} / bucket «${BUCKET_NAME}»`);
    console.log(`📄 Режим: ${args.apply ? 'APPLY' : 'DRY-RUN'}`);

    const objectNames = await listImageObjects(minioClient);
    const computedPaths = await loadComputedPicturePaths(pgClient);
    const pending = objectNames.filter((name) => !computedPaths.has(name));
    const skipped = objectNames.length - pending.length;

    console.log(`🖼 Картинок в bucket: ${objectNames.length}`);
    console.log(`   уже с blurhash: ${skipped}`);
    console.log(`   к вычислению: ${pending.length}`);

    let computed = 0;
    let failed = 0;

    if (args.apply) {
      for (const objectName of pending) {
        try {
          const image = await downloadObject(minioClient, objectName);
          const blurhash = await computeBlurhash(image);
          await pgClient.query(UPSERT_SQL, [objectName, blurhash]);
          computed++;
        } catch (error) {
          failed++;
          console.error(`❌ ${objectName}: ${error.message}`);
        }
      }
    }

    printSummary({
      apply: args.apply,
      total: objectNames.length,
      skipped,
      computed,
      failed,
      pending: pending.length,
    });
  } finally {
    await pgClient.end();
  }
}

main().catch((error) => {
  console.error(`❌ ${error.message}`);
  process.exit(1);
});
