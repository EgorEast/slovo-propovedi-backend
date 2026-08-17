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
  --artist <str>       исполнитель проповедей (по умолчанию «${DEFAULT_ARTIST}»)
  --artwork <str>      URL обложки (по умолчанию пусто)
  --dry-run            показать план без единого сетевого запроса
  --no-skip-existing   всегда загружать файлы, игнорируя дедупликацию по названию
  -h, --help           показать эту справку

Пароль запрашивается только интерактивно (скрытый ввод) — флага/переменной
окружения для пароля нет, чтобы он не попал в историю команд.

Примеры:
  npm run upload-sermons -- "/путь/к/папке" --dry-run
  npm run upload-sermons -- "/путь/к/папке"
  npm run upload-sermons -- "/путь/к/папке" --api http://localhost:3000
  SP_USERNAME=admin npm run upload-sermons -- "/путь/к/папке"
`;

// ---------------------------------------------------------------------------
// Constants for filename parsing
// ---------------------------------------------------------------------------

// "<track>. <Title>. <Book> <chapter> <verseStart>-<verseEnd>" with any mix of
// space/dot/underscore separators and optional trailing junk without digits
// (e.g. "]"). A letter marker in parentheses after a verse number, like
// "5(б)-6(а)", is consumed and dropped. A chapter RANGE is supported:
// "10 23-11 1" → chapter [10, 11], verse [23, 1] — two numbers after the dash
// are endChapter + verseEnd, one number is verseEnd only. DISJOINT VERSE
// SEGMENTS are supported: comma-separated parts after the main verse, each a
// single number or a range — "1 9-18, 20" → chapter 1, verse [[9,18],20].
const MAIN_REF = /^(?<rest>.+?)[\s._]+(?<chapter>\d+)[\s._]+(?<verseStart>\d+)(?:\([^()]*\))?(?:[\s._]*[-–—][\s._]*(?:(?<endChapter>\d+)[\s._]+)?(?<verseEnd>\d+)(?:\([^()]*\))?)?(?<moreParts>(?:[\s._]*,[\s._]*\d+(?:\([^()]*\))?(?:[\s._]*[-–—][\s._]*\d+(?:\([^()]*\))?)?)*)(?<tail>[^0-9]*)$/u;

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

// A book-only reference: the name ends with a known book (optionally with an
// ordinal prefix like «2 Тимофею») and nothing after it — «Введение к посланию
// к Филимону» → book Филимону, chapter/verse null. The API accepts book-only
// references since 0.13.0.
const BOOK_ONLY_RE = new RegExp(`(?:^|[\\s._-])(?<book>(?:\\d+[а-яё]?\\s+)?(?:${KNOWN_BOOKS.join('|')}))$`, 'iu');

// "1е Петра", "2 Коринфянам" — the ordinal prefix is part of the book name.
const ORDINAL_PREFIX = /^\d+[а-яё]?\s+/iu;

// Leading track number: digits + a separator (`.`, `)`, `]`, `_`) before the
// title. A bare digit without a separator is NOT a track number — titles
// like «7 слов со креста» must keep their leading digit. `-` and `—` are
// deliberately NOT separators: «2021-й год», «3-й день творения» and
// «5-я печать» must keep the digit-hyphen-й/я suffix intact.
const TRACK_PREFIX = /^\d+\s*[._)\]]\s*/;
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
// "2 Коринфянам" is fine, but "Иоанна 18" in «Title. Иоанна 18 39 40» means
// the reference was written with a space-separated range («18 39 40») that
// MAIN_REF cannot consume — the regex backtracked and leaked the chapter into
// the book. Chapter RANGES are supported («10 23-11 1» → chapter [10, 11]),
// but only in the dash form; a stray digit in the book is still a parse
// failure and must fail loudly instead of uploading garbage metadata.
function bookHasStrayDigits(book) {
  return containsDigit(book.replace(ORDINAL_PREFIX, ''));
}

// Returns true when a known book name is immediately followed by a number —
// i.e. the name carries a book reference that the ref regexes failed to parse.
function hasBookRefPattern(core) {
  const match = BOOK_TOKEN_RE.exec(core);
  if (!match) return false;
  return containsDigit(core.slice(match.index + match[0].length));
}

// Builds the verse value from the main part and any comma-separated extra
// parts. One part keeps the existing number | [a,b] shape; several parts
// become a segments array. WHY the guard: on the wire a segments array of
// exactly two plain integers ([9, 20]) is indistinguishable from a range —
// the API reads any 2-int array as a range — so two single parts are wrapped
// as [n,n] each to survive the round-trip.
function buildVerse(verseStart, verseEnd, moreParts) {
  const parts = [{ start: Number(verseStart), end: verseEnd ? Number(verseEnd) : null }];
  if (moreParts) {
    const extraPartRe = /[\s._]*,[\s._]*(\d+)(?:\([^()]*\))?(?:[\s._]*[-–—][\s._]*(\d+)(?:\([^()]*\))?)?/gu;
    for (const match of moreParts.matchAll(extraPartRe)) {
      parts.push({ start: Number(match[1]), end: match[2] ? Number(match[2]) : null });
    }
  }
  if (parts.length === 1) {
    return parts[0].end === null ? parts[0].start : [parts[0].start, parts[0].end];
  }
  const segments = parts.map((part) => (part.end === null ? part.start : [part.start, part.end]));
  if (segments.length === 2 && segments.every((segment) => typeof segment === 'number')) {
    return segments.map((segment) => [segment, segment]);
  }
  return segments;
}

// A book-only reference: the name ends with a known book and no digits follow
// it — «Введение к посланию к Филимону» → book Филимону, chapter/verse null.
function tryBookOnlyReference(core) {
  const match = BOOK_ONLY_RE.exec(core);
  if (!match) return null;
  return {
    title: cleanTitle(core.slice(0, match.index)),
    book: cleanBook(match.groups.book),
    chapter: null,
    verse: null,
    warning: null,
  };
}

// A parsed sermon must carry a non-empty title. Title-less names — a
// reference-only file («Филимону 1-7») or a trailing book token that swallowed
// the title («Иоанна 18 39») — cannot be stored by the API and would poison
// the dedup map with a shared "" key, so they fail loudly.
function requireNonEmptyTitle(parsed, fileName) {
  if (!parsed.title.trim()) {
    throw new Error(`Имя файла не содержит названия проповеди — невозможно сохранить: ${fileName}`);
  }
  return parsed;
}

/**
 * Parses a sermon file name into trusted data. Throws with a descriptive
 * Russian message when the name cannot be represented by the API's schema —
 * including names that parse to an empty title.
 *
 * Returns { title, book, chapter, verse, warning } where verse is
 * number | [number, number] | (number | [number, number])[] | null and
 * book/chapter/verse are null for title-only files.
 */
function parseSermonFileName(fileName) {
  const core = stripTrackNumber(stripExtension(fileName));

  const main = MAIN_REF.exec(core);
  if (main) {
    const { rest, chapter, verseStart, verseEnd, endChapter, moreParts } = main.groups;
    const { title, book } = splitTitleBook(rest);
    if (bookHasStrayDigits(book)) {
      throw new Error('В названии книги остались цифры — ссылка на Писание не распознана (диапазон глав поддерживается только в виде «10 23-11 1»)');
    }
    // A reference-only name (no «Title.» prefix) leaves the book empty and the
    // reference digits folded into the title — it cannot be represented by the
    // API's (title, book, chapter, verse) model and must fail loudly instead of
    // uploading garbage metadata.
    if (book === '' && chapter !== null) {
      throw new Error('Имя файла содержит ссылку на Писание без названия проповеди и книги — невозможно сохранить');
    }
    return requireNonEmptyTitle(
      {
        title,
        book,
        chapter: endChapter ? [Number(chapter), Number(endChapter)] : Number(chapter),
        verse: buildVerse(verseStart, verseEnd, moreParts),
        warning: isAsciiOnly(title) || isAsciiOnly(book) ? 'имя файла транслитерировано (латиница)' : null,
      },
      fileName,
    );
  }

  const paren = PAREN_REF.exec(core);
  if (paren) {
    const [, titleRaw, book, chapter, verseStart, verseEnd] = paren;
    return requireNonEmptyTitle(
      {
        title: cleanTitle(titleRaw),
        book: cleanBook(book),
        chapter: Number(chapter),
        verse: verseEnd ? [Number(verseStart), Number(verseEnd)] : Number(verseStart),
        warning: null,
      },
      fileName,
    );
  }

  const single = SINGLE_CHAPTER_REF.exec(core);
  if (single) {
    const { rest, verseStart, verseEnd } = single.groups;
    const { title, book } = splitTitleBook(rest);
    if (SINGLE_CHAPTER_BOOKS.some((bookName) => book.toLowerCase().endsWith(bookName))) {
      return requireNonEmptyTitle(
        {
          title,
          book,
          chapter: 1,
          verse: verseEnd ? [Number(verseStart), Number(verseEnd)] : Number(verseStart),
          warning: null,
        },
        fileName,
      );
    }
  }

  const bookOnly = tryBookOnlyReference(core);
  if (bookOnly) {
    return requireNonEmptyTitle(bookOnly, fileName);
  }

  if (hasBookRefPattern(core)) {
    throw new Error('Не удалось распознать ссылку на Писание в имени файла');
  }

  return requireNonEmptyTitle(
    { title: cleanTitle(core), book: null, chapter: null, verse: null, warning: null },
    fileName,
  );
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
  if (Array.isArray(verse)) {
    if (verse.length === 2 && verse.every((value) => typeof value === 'number')) {
      return `[${verse[0]}, ${verse[1]}]`;
    }
    // Segments: each part renders as a single number or an en-dash range
    // («9–18, 20»); a [n,n] pair is a guarded single and renders as n.
    return verse
      .map((part) =>
        Array.isArray(part)
          ? part[0] === part[1]
            ? String(part[0])
            : `${part[0]}–${part[1]}`
          : String(part),
      )
      .join(', ');
  }
  return String(verse);
}

function formatChapter(chapter) {
  if (chapter === null || chapter === undefined) return '—';
  return Array.isArray(chapter) ? `${chapter[0]}–${chapter[1]}` : String(chapter);
}

// Renders the scripture reference for the plan output. A chapter range
// renders as «3:16–4:2» (chapterStart:verseStart–chapterEnd:verseEnd) or
// «118–119» when the verse is absent; a single chapter keeps the existing
// «3:[16, 18]» style; a book-only reference renders as just the book.
function formatReference(book, chapter, verse) {
  if (!book) return 'без ссылки на Писание';
  if (chapter === null || chapter === undefined) return book;
  if (Array.isArray(chapter)) {
    if (Array.isArray(verse)) {
      return `${book} ${chapter[0]}:${verse[0]}–${chapter[1]}:${verse[1]}`;
    }
    return `${book} ${chapter[0]}–${chapter[1]}`;
  }
  return `${book} ${formatChapter(chapter)}:${formatVerse(verse)}`;
}

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

const VALUE_FLAGS = {
  '--api': 'api',
  '--username': 'username',
  '--artist': 'artist',
  '--artwork': 'artwork',
};

function parseArgs(argv) {
  const args = {
    folder: null,
    api: DEFAULT_API,
    username: null,
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

async function resolveCredentials({ username }) {
  const resolvedUsername = username ?? process.env.SP_USERNAME ?? null;
  return {
    username: resolvedUsername ?? (await promptText('Имя пользователя: ')),
    // Пароль запрашивается ТОЛЬКО интерактивно и скрыто: флага/переменной
    // окружения нет, чтобы пароль не попал в историю команд.
    password: await promptSecret('Пароль: '),
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

async function requestAccessToken(baseUrl, username, password) {
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

  // Initial authentication: fetches the access token without logging — the
  // caller (main) prints its own «Вход выполнен» message. relogin() reuses
  // this and adds its own message for the 401-retry path.
  async function login() {
    token = await requestAccessToken(baseUrl, credentials.username, credentials.password);
    return token;
  }

  async function relogin() {
    await login();
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

  return { request, login, relogin };
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
    json: { title, description: '', artwork },
  });
  console.log(`✅ Плейлист «${title}» создан`);
  return created;
}

// Cursor-paginated sweep over ALL sermons (GET /sermons, take ≤ 100 per page).
// Returns a normalized-title → matches map where each match carries the sermon
// id, its ORIGINAL title (for logging/warnings) and the ids of the playlists
// it already belongs to (from item.playlists).
const SERMONS_PAGE_SIZE = 100;

// Dedup matching is case-insensitive and ignores leading/trailing whitespace —
// «Свидетельства о пришествии Мессии (Часть 1)» on the site matches a file
// parsed as «Свидетельства о пришествии Мессии (часть 1)». The normalized
// form is ONLY the Map key: the stored sermon title is never modified.
function normalizeTitleForDedup(title) {
  return title.trim().toLowerCase();
}

async function sweepAllSermons(request) {
  const byTitle = new Map();
  let cursor = null;
  let total = 0;
  let pages = 0;
  do {
    const query = new URLSearchParams({ take: String(SERMONS_PAGE_SIZE) });
    if (cursor) query.set('cursor', cursor);
    const data = await request(`/sermons?${query}`);
    pages += 1;
    total += data.sermons.length;
    for (const sermon of data.sermons) {
      const entry = {
        id: sermon.id,
        title: sermon.title,
        playlistIds: new Set((sermon.playlists ?? []).map((playlist) => playlist.id)),
      };
      const key = normalizeTitleForDedup(sermon.title);
      if (!byTitle.has(key)) byTitle.set(key, []);
      byTitle.get(key).push(entry);
    }
    cursor = data.nextCursor;
  } while (cursor);
  return { byTitle, total, pages };
}

// PATCH /playlists/:id REPLACES the whole ordered sermon list, and the runtime
// DTO requires title/description/artwork/sermonsIds — so we resend the current
// playlist fields together with the full id list (current order + appended id).
async function replacePlaylistSermons(request, playlistId, playlistDetail, sermonsIds) {
  await request(`/playlists/${playlistId}`, {
    method: 'PATCH',
    json: {
      title: playlistDetail.title,
      description: playlistDetail.description,
      artwork: playlistDetail.artwork,
      sermonsIds,
    },
  });
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
      description: '',
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
    const reference = formatReference(book, chapter, verse);
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

function printSummary({
  playlistTitle,
  uploaded,
  skipped,
  attached,
  ambiguous,
  sweep,
  unparsed,
  nonMp3,
  warnings,
  dryRun = false,
}) {
  console.log('');
  console.log('📊 Итог:');
  console.log(`   плейлист: «${playlistTitle}»`);
  console.log(`   ${dryRun ? 'запланировано к загрузке' : 'загружено'}: ${uploaded}`);
  console.log(`   пропущено (уже в плейлисте): ${skipped}`);
  if (!dryRun) {
    console.log(`   добавлено существующих (по названию): ${attached}`);
    console.log(`   пропущено (несколько совпадений по названию): ${ambiguous}`);
    console.log(`   проповедей в базе: ${sweep.total} (страниц: ${sweep.pages})`);
  }
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
    await api.login();
    console.log(`🔑 Вход выполнен (${args.api})`);

    const playlist = await findOrCreatePlaylist(api.request, playlistTitle, args.artwork);
    console.log(`📋 Плейлист: «${playlist.title}» (id=${playlist.id})`);

    // The target playlist's current sermon ids IN ORDER — GET /playlists/:id
    // returns them ordered by position; these stay the source of truth for
    // every PATCH append.
    const playlistDetail = await api.request(`/playlists/${playlist.id}`);
    const playlistSermonIds = (playlistDetail.sermons ?? []).map((sermon) => sermon.id);

    // Global dedup: sweep ALL sermons (cursor pagination) into a title → matches
    // map; each match carries the ids of the playlists it already belongs to.
    const sweep = await sweepAllSermons(api.request);
    console.log(`🔎 Проповедей в базе: ${sweep.total} (страниц: ${sweep.pages})`);

    const uploaded = [];
    const skipped = [];
    const attached = [];
    const ambiguous = [];

    for (let index = 0; index < parsed.length; index++) {
      const file = parsed[index];
      const label = `[${index + 1}/${parsed.length}]`;
      const title = file.parsed.title;

      if (args.skipExisting) {
        const key = normalizeTitleForDedup(title);
        const matches = sweep.byTitle.get(key) ?? [];
        if (matches.length > 1) {
          console.log(
            `${label} ⚠ «${title}» — найдено несколько проповедей с таким названием: ${matches
              .map((match) => `«${match.title}» (id=${match.id})`)
              .join(', ')}; файл пропущен`,
          );
          ambiguous.push(title);
          continue;
        }
        if (matches.length === 1) {
          const existing = matches[0];
          if (playlistSermonIds.includes(existing.id)) {
            console.log(
              `${label} ⏭ уже существует и в плейлисте: «${existing.title}» (id=${existing.id})`,
            );
            skipped.push(title);
            continue;
          }
          const sermonsIds = [...playlistSermonIds, existing.id];
          await replacePlaylistSermons(api.request, playlist.id, playlistDetail, sermonsIds);
          console.log(
            `${label} ↩ добавлена существующая «${existing.title}» (id=${existing.id})`,
          );
          attached.push(title);
          playlistSermonIds.push(existing.id);
          continue;
        }
      }

      let audioUrl;
      try {
        audioUrl = await uploadAudio(api.request, file.path, file.fileName);
      } catch (error) {
        console.error(`✗ Ошибка при загрузке аудио «${file.fileName}»:`);
        console.error(`  файл: ${file.path}`);
        console.error(`  ${describeRequestError(error)}`);
        process.exit(1);
      }

      try {
        const sermonId = await createSermon(api.request, {
          title,
          artist: args.artist,
          artwork: args.artwork,
          parsed: file.parsed,
          audioUrl,
          playlistId: playlist.id,
        });
        console.log(`${label} ✅ «${title}» → id=${sermonId}`);
        uploaded.push(title);
        playlistSermonIds.push(sermonId);
        // Track in-run creations so later in-folder duplicates are skipped too.
        const createdKey = normalizeTitleForDedup(title);
        if (!sweep.byTitle.has(createdKey)) sweep.byTitle.set(createdKey, []);
        sweep.byTitle
          .get(createdKey)
          .push({ id: sermonId, title, playlistIds: new Set([playlist.id]) });
      } catch (error) {
        console.error(
          `⚠ Аудио загружено, но проповедь не создана — файл остался в MinIO без записи: ${audioUrl}`,
        );
        console.error(`✗ Ошибка при создании проповеди «${file.fileName}»:`);
        console.error(`  файл: ${file.path}`);
        console.error(`  ${describeRequestError(error)}`);
        process.exit(1);
      }
    }

    printSummary({
      playlistTitle,
      uploaded: uploaded.length,
      skipped: skipped.length,
      attached: attached.length,
      ambiguous: ambiguous.length,
      sweep: { total: sweep.total, pages: sweep.pages },
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
    printSummary({
      playlistTitle,
      uploaded: parsed.length,
      skipped: 0,
      attached: 0,
      ambiguous: 0,
      sweep: { total: 0, pages: 0 },
      unparsed,
      nonMp3,
      warnings,
      dryRun: true,
    });
    process.exit(0);
  }

  await runUpload(args, { folderName, playlistTitle, parsed, unparsed, nonMp3, warnings });
}

main();
