#!/usr/bin/env node

/**
 * Backfills sermon.created_at / playlist.created_at from the MinIO object
 * mtimes (a sermon's audio file, else its text file, else its artwork; a
 * playlist's artwork, else the earliest created_at of its sermons).
 *
 * Migration 013a seeds every existing row with one identical placeholder
 * timestamp, so this script restores real per-row dates. It is DRY-RUN by
 * default: it prints what it would change and only writes with --apply.
 * Idempotent by construction — object mtimes are stable.
 *
 * Run `node scripts/backfill-created-at.mjs --help` for the usage in Russian.
 */

import { Client as PgClient } from 'pg';
import * as Minio from 'minio';

// Keep in sync with MinioService.BUCKET_NAME (src/minio/minio.service.ts).
const BUCKET_NAME = 'files';

// Stored file URLs look like `${MINIO_PUBLIC_URI}/files/<object>`. Only the
// path is inspected — the host is ignored — parsing mirrors MinioService
// (see minio.service.ts ~line 337).
const FILES_PATH_PREFIX = `/${BUCKET_NAME}/`;

const USAGE = `
Бэкфилл created_at проповедей и плейлистов по mtime объектов в MinIO.

По умолчанию выполняется DRY-RUN: печатает план и ничего не записывает.

Использование:
  npm run backfill-created-at [флаги]
  node --env-file-if-exists=.env scripts/backfill-created-at.mjs [флаги]

Флаги:
  --apply              записать вычисленные даты в БД (без флага — только план)
  -h, --help           показать эту справку

Порядок выбора даты:
  проповедь  — mtime(audio-url) ?? mtime(text-file-url) ?? mtime(artwork)
  плейлист   — mtime(artwork) ?? MIN(created_at) связанных проповедей

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

// Returns the object key for a stored file URL, or null when the URL is empty,
// malformed, or points outside the bucket.
function objectKeyFromUrl(fileUrl) {
  if (!fileUrl) {
    return null;
  }
  try {
    const { pathname } = new URL(fileUrl);
    if (!pathname.startsWith(FILES_PATH_PREFIX)) {
      return null;
    }
    return pathname.slice(FILES_PATH_PREFIX.length);
  } catch {
    return null;
  }
}

// Whole-bucket scan — bucket sizes are modest, so a full index is simpler and
// faster than one statObject per referenced file.
async function buildLastModifiedIndex(minioClient) {
  const index = new Map();
  for await (const object of minioClient.listObjectsV2(BUCKET_NAME, '', true)) {
    if (object.name && object.lastModified) {
      index.set(object.name, object.lastModified);
    }
  }
  return index;
}

function modifiedAt(index, fileUrl) {
  const objectKey = objectKeyFromUrl(fileUrl);
  return objectKey ? index.get(objectKey) : undefined;
}

const formatDate = (date) => (date ? date.toISOString() : '—');

async function backfillSermons(pgClient, index, { apply, samples }) {
  const { rows } = await pgClient.query(
    'SELECT id, "audio-url", "text-file-url", artwork FROM sermon ORDER BY id',
  );

  let dated = 0;
  let skipped = 0;
  for (const row of rows) {
    const candidate =
      modifiedAt(index, row['audio-url']) ??
      modifiedAt(index, row['text-file-url']) ??
      modifiedAt(index, row.artwork);

    if (!candidate) {
      skipped++;
      continue;
    }

    if (samples.length < 5) {
      samples.push({ kind: 'проповедь', id: row.id, createdAt: candidate });
    }
    if (apply) {
      await pgClient.query(
        'UPDATE sermon SET created_at = $1 WHERE id = $2',
        [candidate, row.id],
      );
    }
    dated++;
  }

  return { total: rows.length, dated, skipped };
}

async function backfillPlaylists(pgClient, index, { apply, samples }) {
  const { rows } = await pgClient.query(
    'SELECT id, artwork FROM playlist ORDER BY id',
  );

  let dated = 0;
  let skipped = 0;
  let byArtwork = 0;
  let byMembers = 0;

  for (const row of rows) {
    const artworkDate = modifiedAt(index, row.artwork);
    let candidate = artworkDate;
    let source = 'artwork';

    if (!candidate) {
      // The join column names are the quoted camelCase FKs from migration 001.
      const { rows: fallbackRows } = await pgClient.query(
        `SELECT MIN(s.created_at) AS "minCreatedAt"
           FROM playlist_sermons_sermon j
           JOIN sermon s ON s.id = j."sermonId"
          WHERE j."playlistId" = $1`,
        [row.id],
      );
      candidate = fallbackRows[0]?.minCreatedAt ?? undefined;
      source = 'members';
    }

    if (!candidate) {
      skipped++;
      continue;
    }

    if (samples.length < 5) {
      samples.push({ kind: 'плейлист', id: row.id, createdAt: candidate });
    }
    if (apply) {
      await pgClient.query(
        'UPDATE playlist SET created_at = $1 WHERE id = $2',
        [candidate, row.id],
      );
    }
    if (source === 'artwork') {
      byArtwork++;
    } else {
      byMembers++;
    }
    dated++;
  }

  return { total: rows.length, dated, skipped, byArtwork, byMembers };
}

function printSummary({ apply, sermons, playlists, samples }) {
  console.log('');
  console.log(apply ? '📊 Итог (записано):' : '📊 Итог (dry-run, ничего не записано):');
  console.log(
    `   проповеди: всего ${sermons.total}, датировано ${sermons.dated}, пропущено ${sermons.skipped}`,
  );
  console.log(
    `   плейлисты: всего ${playlists.total}, датировано ${playlists.dated}, пропущено ${playlists.skipped}` +
      ` (по artwork: ${playlists.byArtwork}, по проповедям: ${playlists.byMembers})`,
  );
  if (!apply && samples.length) {
    console.log('');
    console.log('   Примеры переразметки:');
    for (const sample of samples) {
      console.log(
        `      ${sample.kind} ${sample.id} → ${formatDate(sample.createdAt)}`,
      );
    }
  }
  if (!apply) {
    console.log('');
    console.log('   Для записи повторите с --apply.');
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);
  if (args.help) {
    console.log(USAGE);
    return;
  }

  const pgClient = createPgClient();
  const minioClient = createMinioClient();

  try {
    await pgClient.connect();
    console.log(`🐘 PostgreSQL: ${process.env.POSTGRES_DB}@${process.env.POSTGRES_HOST}`);
    console.log(`🪣 MinIO: ${process.env.MINIO_ENDPOINT} / bucket «${BUCKET_NAME}»`);
    console.log(`📄 Режим: ${args.apply ? 'APPLY' : 'DRY-RUN'}`);

    const index = await buildLastModifiedIndex(minioClient);
    console.log(`🔎 Объектов в bucket: ${index.size}`);

    const samples = [];
    const sermons = await backfillSermons(pgClient, index, {
      apply: args.apply,
      samples,
    });
    const playlists = await backfillPlaylists(pgClient, index, {
      apply: args.apply,
      samples,
    });

    printSummary({ apply: args.apply, sermons, playlists, samples });
  } finally {
    await pgClient.end();
  }
}

main().catch((error) => {
  console.error(`❌ ${error.message}`);
  process.exit(1);
});
