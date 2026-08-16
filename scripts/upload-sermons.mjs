#!/usr/bin/env node

/**
 * Bulk-uploads a folder of MP3 sermon files into the API as sermons attached
 * to a single playlist (one folder = one playlist).
 *
 * Pure Node.js >= 20 ESM: global fetch, FormData and Blob are used as-is.
 * Run `node scripts/upload-sermons.mjs --help` for the full usage in Russian.
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import readline from 'node:readline';
import { stdin as input, stdout as output } from 'node:process';

const DEFAULT_API = 'https://api.slovo-propovedi.ru';
const DEFAULT_ARTIST = 'Андрей Вовк';
const DEFAULT_ARTWORK = '';

const USAGE = `
Скрипт массовой загрузки mp3-проповедей в API. Каждая папка = один плейлист.

Использование:
  npm run upload-sermons -- <путь-к-папке> [флаги]
  node scripts/upload-sermons.mjs <путь-к-папке> [флаги]

Аргументы:
  <путь-к-папке>      папка с mp3-файлами

Флаги:
  --api <url>          базовый URL API (по умолчанию ${DEFAULT_API})
  --username <str>     имя пользователя (приоритет: флаг > SP_USERNAME > интерактивный ввод)
  --password <str>     пароль (приоритет: флаг > SP_PASSWORD > интерактивный ввод, скрытый)
  --artist <str>       исполнитель проповедей (по умолчанию «${DEFAULT_ARTIST}»)
  --artwork <str>      URL обложки (по умолчанию пусто)
  --dry-run            показать план без единого сетевого запроса
  --no-skip-existing   не пропускать файлы, названия которых уже есть в плейлисте
  -h, --help           показать эту справку

Примеры:
  npm run upload-sermons -- "/путь/к/папке" --dry-run
  npm run upload-sermons -- "/путь/к/папке"
  npm run upload-sermons -- "/путь/к/папке" --api http://localhost:3000
  SP_USERNAME=admin SP_PASSWORD=secret npm run upload-sermons -- "/путь/к/папке"
`;

// ---------------------------------------------------------------------------
// Constants for filename parsing
// ---------------------------------------------------------------------------

// "<track>. <Title>. <Book> <chapter> <verseStart>-<verseEnd>" with any mix of
// space/dot/underscore separators and optional trailing junk without digits
// (e.g. "]"). A letter marker in parentheses after a verse number, like
// "5(б)-6(а)", is consumed and dropped.
const MAIN_REF = /^(?<rest>.+?)[\s._]+(?<chapter>\d+)[\s._]+(?<verseStart>\d+)(?:\([^()]*\))?(?:[\s._]*[-–—][\s._]*(?<verseEnd>\d+)(?:\([^()]*\))?)?(?<tail>[^0-9]*)$/u;

// "<Title> (Отк.1,1-3)" — the reference is parenthesized with comma
// separators (book abbreviations used in the Откровение folder).
const PAREN_REF = /^(.+?)\s*\((?<book>[\p{L}\s.'-]+?)[,.]\s*(?<chapter>\d+)\s*[,.]\s*(?<verseStart>\d+)(?:\s*[-–—]\s*(?<verseEnd>\d+))?\)\s*$/u;

// "<Title>. Филимону 1-7" — single-chapter books omit the chapter number.
const SINGLE_CHAPTER_REF = /^(?<rest>.+?)[\s._]+(?<verseStart>\d+)(?:\([^()]*\))?(?:[\s._]*[-–—][\s._]*(?<verseEnd>\d+)(?:\([^()]*\))?)?(?<tail>[^0-9]*)$/u;

const SINGLE_CHAPTER_BOOKS = ['филимону', 'иуды', 'авдия', '2 иоанна', '3 иоанна'];

const KNOWN_BOOKS = [
  'Матфея', 'Марка', 'Луки', 'Иоанна', 'Деяния', 'Иакова', 'Петра',
  'Коринфянам', 'Фессалоникийцам', 'Титу', 'Филимону', 'Ефесянам',
  'Филиппийцам', 'Откровение', 'Отк', 'Евреям', 'Римлянам', 'Галатам',
  'Колоссянам', 'Тимофею', 'Иуды',
];

// \b is ASCII-only, so Cyrillic books need explicit Unicode boundaries.
const BOOK_TOKEN_RE = new RegExp(`(?<!\\p{L})(?:${KNOWN_BOOKS.join('|')})(?!\\p{L})`, 'iu');

// "1е Петра", "2 Коринфянам" — the ordinal prefix is part of the book name.
const ORDINAL_PREFIX = /^\d+[а-яё]?\s+/iu;

const TRACK_PREFIX = /^\d+\s*[._-]?\s*/;
const LEADING_SEPARATORS = /^[\s._-]+/;

// ---------------------------------------------------------------------------
// Pure parsing helpers
// ---------------------------------------------------------------------------

function stripExtension(fileName) {
  if (!/\.mp3$/i.test(fileName)) {
    throw new Error(`Файл не имеет расширения .mp3: «${fileName}»`);
  }
  return fileName.replace(/\.mp3$/i, '');
}

function stripTrackNumber(base) {
  return base.replace(TRACK_PREFIX, '').replace(LEADING_SEPARATORS, '');
}

function collapseWhitespace(text) {
  return text.replace(/\s+/g, ' ').trim();
}

function cleanTitle(raw) {
  return collapseWhitespace(raw)
    .replace(/^[\s.,;:!?"'`\u2013\u2014-]+/, '')
    .replace(/[\s.,;:!?"'`\u2013\u2014-]+$/, '')
    .trim();
}

function cleanBook(raw) {
  return collapseWhitespace(raw).replace(/^[\s._-]+/, '').replace(/[\s._-]+$/, '').trim();
}

// Splits the "rest" into title and book. If the rest contains a dot, the book
// is the last dot-separated segment; otherwise it is the last whitespace token.
function splitTitleBook(rest) {
  if (rest.includes('.')) {
    const lastDot = rest.lastIndexOf('.');
    return { title: cleanTitle(rest.slice(0, lastDot)), book: cleanBook(rest.slice(lastDot + 1)) };
  }
  const tokens = collapseWhitespace(rest).split(' ');
  return { title: cleanTitle(tokens.slice(0, -1).join(' ')), book: cleanBook(tokens.at(-1)) };
}

function isAsciiOnly(text) {
  return /^[\x00-\x7F]*$/.test(text);
}

function containsDigit(text) {
  return /\d/.test(text);
}

// A parsed book must not carry stray digits after its ordinal prefix:
// "2 Коринфянам" is fine, "Иоанна 18 39" means the reference crosses
// chapters and cannot be stored in the API's single (chapter, verse) pair.
function bookCrossesChapters(book) {
  return containsDigit(book.replace(ORDINAL_PREFIX, ''));
}

// Returns true when a known book name is immediately followed by a number —
// i.e. the name carries a book reference that the ref regexes failed to parse.
function hasBookRefPattern(core) {
  const match = BOOK_TOKEN_RE.exec(core);
  if (!match) return false;
  return containsDigit(core.slice(match.index + match[0].length));
}

/**
 * Parses a sermon file name into trusted data. Throws with a descriptive
 * Russian message when the name cannot be represented by the API's schema.
 *
 * Returns { title, book, chapter, verse, warning } where verse is
 * number | [number, number] | null and book/chapter/verse are null for
 * title-only files.
 */
function parseSermonFileName(fileName) {
  const core = stripTrackNumber(stripExtension(fileName));

  const main = MAIN_REF.exec(core);
  if (main) {
    const { rest, chapter, verseStart, verseEnd } = main.groups;
    const { title, book } = splitTitleBook(rest);
    if (bookCrossesChapters(book)) {
      throw new Error('Ссылка на Писание пересекает главы и не может быть сохранена в одном поле «глава»');
    }
    // A reference-only name (no «Title.» prefix) leaves the book empty and the
    // reference digits folded into the title — it cannot be represented by the
    // API's (title, book, chapter, verse) model and must fail loudly instead of
    // uploading garbage metadata.
    if (book === '' && chapter !== null) {
      throw new Error('Имя файла содержит ссылку на Писание без названия проповеди и книги — невозможно сохранить');
    }
    return {
      title,
      book,
      chapter: Number(chapter),
      verse: verseEnd ? [Number(verseStart), Number(verseEnd)] : Number(verseStart),
      warning: isAsciiOnly(title) || isAsciiOnly(book) ? 'имя файла транслитерировано (латиница)' : null,
    };
  }

  const paren = PAREN_REF.exec(core);
  if (paren) {
    const [, titleRaw, book, chapter, verseStart, verseEnd] = paren;
    return {
      title: cleanTitle(titleRaw),
      book: cleanBook(book),
      chapter: Number(chapter),
      verse: verseEnd ? [Number(verseStart), Number(verseEnd)] : Number(verseStart),
      warning: null,
    };
  }

  const single = SINGLE_CHAPTER_REF.exec(core);
  if (single) {
    const { rest, verseStart, verseEnd } = single.groups;
    const { title, book } = splitTitleBook(rest);
    if (SINGLE_CHAPTER_BOOKS.some((bookName) => book.toLowerCase().endsWith(bookName))) {
      return {
        title,
        book,
        chapter: 1,
        verse: verseEnd ? [Number(verseStart), Number(verseEnd)] : Number(verseStart),
        warning: null,
      };
    }
  }

  if (hasBookRefPattern(core)) {
    throw new Error('Не удалось распознать ссылку на Писание в имени файла');
  }

  return { title: cleanTitle(core), book: null, chapter: null, verse: null, warning: null };
}

// ---------------------------------------------------------------------------
// Folder name → playlist title, file listing, natural ordering
// ---------------------------------------------------------------------------

function playlistTitleFromFolderName(folderName) {
  return folderName.replace(/^\d+\s*[._-]?\s*/, '').trim();
}

function leadingTrackNumber(fileName) {
  const match = /^\s*(\d+)/.exec(fileName);
  return match ? Number(match[1]) : null;
}

const NAME_COLLATOR = new Intl.Collator('ru', { numeric: true, sensitivity: 'base' });

// Numbered files first (by the leading integer), then unnumbered ones;
// alphabetical within each group.
function compareSermonFiles(a, b) {
  const aNumber = leadingTrackNumber(a);
  const bNumber = leadingTrackNumber(b);
  if (aNumber !== null && bNumber !== null && aNumber !== bNumber) return aNumber - bNumber;
  if (aNumber !== null && bNumber === null) return -1;
  if (aNumber === null && bNumber !== null) return 1;
  return NAME_COLLATOR.compare(a, b);
}

async function listFolderEntries(folderPath) {
  const entries = await readdir(folderPath, { withFileTypes: true });
  const mp3 = [];
  const nonMp3 = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (/\.mp3$/i.test(entry.name)) mp3.push(entry.name);
    else nonMp3.push(entry.name);
  }
  return { mp3, nonMp3 };
}

function parseAllFileNames(mp3Names, folderPath) {
  const parsed = [];
  const unparsed = [];
  const warnings = [];
  for (const fileName of mp3Names) {
    try {
      const result = parseSermonFileName(fileName);
      if (result.warning) warnings.push(`${fileName}: ${result.warning}`);
      parsed.push({ fileName, path: join(folderPath, fileName), parsed: result });
    } catch (error) {
      unparsed.push({ fileName, path: join(folderPath, fileName), error: error.message });
    }
  }
  return { parsed, unparsed, warnings };
}

function formatVerse(verse) {
  if (verse === null || verse === undefined) return '—';
  return Array.isArray(verse) ? `[${verse[0]}, ${verse[1]}]` : String(verse);
}

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

const VALUE_FLAGS = {
  '--api': 'api',
  '--username': 'username',
  '--password': 'password',
  '--artist': 'artist',
  '--artwork': 'artwork',
};

function parseArgs(argv) {
  const args = {
    folder: null,
    api: DEFAULT_API,
    username: null,
    password: null,
    artist: DEFAULT_ARTIST,
    artwork: DEFAULT_ARTWORK,
    dryRun: false,
    skipExisting: true,
  };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--dry-run') {
      args.dryRun = true;
    } else if (arg === '--no-skip-existing') {
      args.skipExisting = false;
    } else if (arg in VALUE_FLAGS) {
      const value = argv[index + 1];
      if (value === undefined) throw new Error(`Флаг ${arg} требует значение.`);
      args[VALUE_FLAGS[arg]] = value;
      index++;
    } else if (arg.startsWith('-')) {
      throw new Error(`Неизвестный флаг: ${arg}`);
    } else if (args.folder === null) {
      args.folder = arg;
    } else {
      throw new Error(`Указано несколько папок: «${args.folder}» и «${arg}». Запускайте по одной папке за раз.`);
    }
  }
  return args;
}

// ---------------------------------------------------------------------------
// Interactive prompts
// ---------------------------------------------------------------------------

function promptText(question) {
  const rl = readline.createInterface({ input, output });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

// Reads a secret while muting the echo: the question is printed first, then
// every subsequent write keeps only newlines (no asterisks, just silence).
function promptSecret(question) {
  const rl = readline.createInterface({ input, output });
  process.stdout.write(question);
  const originalWrite = output.write;
  output.write = (chunk, encoding, callback) =>
    originalWrite.call(output, String(chunk).replace(/[^\n]/g, ''), encoding, callback);
  return new Promise((resolve) => {
    rl.question('', (answer) => {
      output.write = originalWrite;
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

async function resolveCredentials({ username, password }) {
  const resolvedUsername = username ?? process.env.SP_USERNAME ?? null;
  const resolvedPassword = password ?? process.env.SP_PASSWORD ?? null;
  return {
    username: resolvedUsername ?? (await promptText('Имя пользователя: ')),
    password: resolvedPassword ?? (await promptSecret('Пароль: ')),
  };
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

class HttpError extends Error {
  constructor(status, bodyText, method, path) {
    super(`HTTP ${status} для ${method} ${path}`);
    this.status = status;
    this.bodyText = bodyText;
  }
}

async function apiRequest(baseUrl, path, { method = 'GET', token = null, json = null, formData = null } = {}) {
  const headers = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  let body;
  if (json !== null) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(json);
  } else if (formData) {
    body = formData;
  }
  const response = await fetch(`${baseUrl}${path}`, { method, headers, body });
  if (!response.ok) {
    throw new HttpError(response.status, await response.text(), method, path);
  }
  return response.json();
}

async function login(baseUrl, username, password) {
  try {
    const data = await apiRequest(baseUrl, '/auth/login', { method: 'POST', json: { username, password } });
    if (!data.accessToken) throw new Error('Сервер не вернул accessToken после входа.');
    return data.accessToken;
  } catch (error) {
    if (error instanceof HttpError && error.status === 401) {
      throw new Error('Неверное имя пользователя или пароль (HTTP 401).');
    }
    if (error instanceof HttpError) {
      throw new Error(`Ошибка входа (HTTP ${error.status}): ${error.bodyText || error.message}`);
    }
    throw new Error(`Не удалось подключиться к API: ${error.message}`);
  }
}

// Wraps authenticated requests with automatic re-login: JWT access tokens
// expire after ~30 minutes, so on a long run every 401 after the initial login
// triggers a silent re-login (reusing the already-collected credentials, no
// re-prompt) and exactly one retry of the current operation. A persistent 401
// after re-login fails fast with a clear Russian error.
function createApiClient(baseUrl, credentials) {
  let token = null;

  async function relogin() {
    token = await login(baseUrl, credentials.username, credentials.password);
    console.log(`🔑 Повторный вход выполнен (${baseUrl})`);
  }

  async function request(path, options = {}) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await apiRequest(baseUrl, path, { ...options, token });
      } catch (error) {
        if (error instanceof HttpError && error.status === 401) {
          if (attempt >= 1) {
            throw new Error('Повторный вход не восстановил доступ (HTTP 401) — прерывание.');
          }
          await relogin();
          continue;
        }
        throw error;
      }
    }
  }

  return { request, relogin };
}

async function findOrCreatePlaylist(request, title, artwork) {
  const data = await request('/playlists');
  const matches = data.playlists.filter((playlist) => playlist.title.trim().toLowerCase() === title.toLowerCase());
  if (matches.length > 1) {
    throw new Error(
      `Найдено несколько плейлистов с названием «${title}» (id: ${matches.map((playlist) => playlist.id).join(', ')}). ` +
        'Переименуйте дубликаты и повторите.',
    );
  }
  if (matches.length === 1) return matches[0];
  const created = await request('/playlists', {
    method: 'POST',
    json: { title, description: null, artwork },
  });
  console.log(`✅ Плейлист «${title}» создан`);
  return created;
}

async function existingSermonTitles(request, playlistId) {
  const data = await request(`/playlists/${playlistId}`);
  return new Set((data.sermons ?? []).map((sermon) => sermon.title));
}

async function uploadAudio(request, filePath, fileName) {
  const buffer = await readFile(filePath);
  const formData = new FormData();
  formData.append('file', new Blob([buffer], { type: 'audio/mpeg' }), fileName);
  const data = await request('/files', { method: 'POST', formData });
  return data.fileUrl;
}

async function createSermon(request, { title, artist, artwork, parsed, audioUrl, playlistId }) {
  const sermon = await request('/sermons', {
    method: 'POST',
    json: {
      title,
      description: null,
      textFileUrl: null,
      audioUrl,
      youtubeUrl: null,
      artist,
      artwork,
      book: parsed.book,
      chapter: parsed.chapter,
      verse: parsed.verse,
      playlistsIds: [playlistId],
    },
  });
  return sermon.id;
}

// ---------------------------------------------------------------------------
// Output helpers
// ---------------------------------------------------------------------------

function printPlan({ folderName, playlistTitle, artist, parsed, unparsed, nonMp3 }) {
  console.log(`📂 Плейлист: «${playlistTitle}» (папка: «${folderName}»)`);
  console.log(`👤 Исполнитель: ${artist}`);
  console.log('');
  for (let index = 0; index < parsed.length; index++) {
    const file = parsed[index];
    const { title, book, chapter, verse, warning } = file.parsed;
    const reference = book ? `${book} ${chapter}:${formatVerse(verse)}` : 'без ссылки на Писание';
    const note = warning ? `  ⚠ ${warning}` : '';
    console.log(`[${index + 1}/${parsed.length}] «${title}» — ${reference}${note}`);
  }
  for (const file of unparsed) {
    console.log(`✗ «${file.fileName}» — ${file.error}`);
  }
  for (const name of nonMp3) {
    console.log(`⚠ не-mp3 файл: «${name}»`);
  }
}

function printSummary({ playlistTitle, uploaded, skipped, unparsed, nonMp3, warnings, dryRun = false }) {
  console.log('');
  console.log('📊 Итог:');
  console.log(`   плейлист: «${playlistTitle}»`);
  console.log(`   ${dryRun ? 'запланировано к загрузке' : 'загружено'}: ${uploaded}`);
  console.log(`   пропущено (уже в плейлисте): ${skipped}`);
  if (unparsed.length > 0) {
    console.log(`   не распознано (пропущено): ${unparsed.length}`);
    for (const file of unparsed) console.log(`      ✗ «${file.fileName}» — ${file.error}`);
  }
  if (nonMp3.length > 0) {
    console.log(`   не-mp3 файлы (не загружаются): ${nonMp3.length}`);
    for (const name of nonMp3) console.log(`      ⚠ «${name}»`);
  }
  if (warnings.length > 0) {
    console.log(`   предупреждения: ${warnings.length}`);
    for (const warning of warnings) console.log(`      ⚠ ${warning}`);
  }
}

function describeRequestError(error) {
  if (error instanceof HttpError) {
    return `HTTP ${error.status}: ${error.bodyText || error.message}`;
  }
  return error.message;
}

// ---------------------------------------------------------------------------
// Main flow
// ---------------------------------------------------------------------------

async function runUpload(args, { folderName, playlistTitle, parsed, unparsed, nonMp3, warnings }) {
  try {
    const credentials = await resolveCredentials(args);
    const api = createApiClient(args.api, credentials);
    await api.relogin();
    console.log(`🔑 Вход выполнен (${args.api})`);

    const playlist = await findOrCreatePlaylist(api.request, playlistTitle, args.artwork);
    console.log(`📋 Плейлист: «${playlist.title}» (id=${playlist.id})`);

    const existingTitles = await existingSermonTitles(api.request, playlist.id);
    const skipped = [];
    const uploaded = [];

    for (let index = 0; index < parsed.length; index++) {
      const file = parsed[index];
      const label = `[${index + 1}/${parsed.length}]`;
      if (args.skipExisting && existingTitles.has(file.parsed.title)) {
        console.log(`${label} ⏭ уже в плейлисте: «${file.parsed.title}»`);
        skipped.push(file.parsed.title);
        continue;
      }
      try {
        const audioUrl = await uploadAudio(api.request, file.path, file.fileName);
        const sermonId = await createSermon(api.request, {
          title: file.parsed.title,
          artist: args.artist,
          artwork: args.artwork,
          parsed: file.parsed,
          audioUrl,
          playlistId: playlist.id,
        });
        console.log(`${label} ✅ «${file.parsed.title}» → id=${sermonId}`);
        uploaded.push(file.parsed.title);
      } catch (error) {
        console.error(`✗ Ошибка при обработке «${file.fileName}»:`);
        console.error(`  файл: ${file.path}`);
        console.error(`  ${describeRequestError(error)}`);
        process.exit(1);
      }
    }

    printSummary({
      playlistTitle,
      uploaded: uploaded.length,
      skipped: skipped.length,
      unparsed,
      nonMp3,
      warnings,
    });
    process.exit(0);
  } catch (error) {
    console.error(`❌ ${describeRequestError(error)}`);
    process.exit(1);
  }
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(USAGE);
    process.exit(0);
  }

  let args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    console.error(`❌ ${error.message}`);
    console.error(USAGE);
    process.exit(1);
  }

  if (args.folder === null) {
    console.error('❌ Укажите путь к папке с mp3-файлами.');
    console.error(USAGE);
    process.exit(1);
  }

  let folderStat;
  try {
    folderStat = await stat(args.folder);
  } catch {
    console.error(`❌ Папка не найдена: ${args.folder}`);
    process.exit(1);
  }
  if (!folderStat.isDirectory()) {
    console.error(`❌ Указанный путь — не папка: ${args.folder}`);
    process.exit(1);
  }

  const folderName = basename(args.folder);
  const playlistTitle = playlistTitleFromFolderName(folderName);

  const { mp3, nonMp3 } = await listFolderEntries(args.folder);
  if (mp3.length === 0) {
    console.error(`❌ В папке «${args.folder}» нет mp3-файлов.`);
    process.exit(1);
  }

  mp3.sort(compareSermonFiles);
  const { parsed, unparsed, warnings } = parseAllFileNames(mp3, args.folder);

  if (parsed.length === 0) {
    console.error(`❌ Не удалось распознать ни одного mp3-файла в папке «${args.folder}».`);
    console.error(`   Исправьте имена файлов (не распознано: ${unparsed.length}) и повторите.`);
    for (const file of unparsed) console.error(`      ✗ «${file.fileName}» — ${file.error}`);
    process.exit(1);
  }

  if (args.dryRun) {
    printPlan({ folderName, playlistTitle, artist: args.artist, parsed, unparsed, nonMp3 });
    printSummary({ playlistTitle, uploaded: parsed.length, skipped: 0, unparsed, nonMp3, warnings, dryRun: true });
    process.exit(0);
  }

  await runUpload(args, { folderName, playlistTitle, parsed, unparsed, nonMp3, warnings });
}

main();
