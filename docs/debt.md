# Технический долг

Реестр «срезанных углов» (TODO/hack/known-issues) и инцидентов. Запись добавляется в том же PR/коммите, что и код, к которому она относится (см. [`README.md`](./README.md), правило 3).

## 1. `GET /playlists` — тот же паттерн full-fetch + deep join

`src/playlist/playlist.service.ts` — `findAll` в режиме **полной выборки** (без `search`/`page`/`limit`, дефолт `date`/`desc`) грузит весь каталог через `findAndCount` с глубоким графом `PLAYLIST_RELATIONS` — тот же паттерн full-fetch + deep relation join, который приводил к OOM на `GET /sermons` (см. инцидент ниже). Пока каталог небольшой — терпимо, но до роста каталога нужен тот же рефакторинг, что и в `SermonService.findAll`: join-свободная страница + линейная сборка графа.

## 2. `GET /health` — no-op

`src/health/health.controller.ts` возвращает `{ status: 'ok' }` без единой проверки зависимостей (БД, MinIO). Во время инцидента 2026-08-16 это — слепое пятно мониторинга: health был «зелёным», пока приложение фактически не отвечало (OOM). Нужна реальная проверка живости.

## 3. `assembleSermonGraph` — torn-read окно между линейными запросами

`SermonService.assembleSermonGraph` собирает граф из нескольких последовательных SELECT-запросов без единого снимка (snapshot): конкурентный DELETE с FK-CASCADE между запросом 1 (join-ы страницы) и запросом 2 (плейлисты) даст висячий join и fail-fast 500 вместо устаревших данных. Окно — миллисекунды, трафик админ-масштаба, поэтому решение принято осознанно (fail-fast на пропавшем родителе вместо REPEATABLE READ-транзакции). Будущее средство — обернуть чтение графа в транзакцию с уровнем изоляции REPEATABLE READ.

## 4. `nestjs-zod` не заявляет peer-диапазон под актуальный `@nestjs/*` — scoped `overrides`

`nestjs-zod` в `peerDependencies` ограничивает `@nestjs/common` диапазоном `^10 || ^11` (`@nestjs/swagger` — `^7.4.2 || ^8.0.0 || ^11`), тогда как проект уже ушёл вперёд по мажору. Чтобы `npm install` не падал по peer-конфликту, в `package.json` добавлены **scoped `overrides`** (`"nestjs-zod": { "@nestjs/common": "$@nestjs/common", "@nestjs/swagger": "$@nestjs/swagger" }`) — точечный pin на уже установленные версии. Это **временный** workaround; выбран именно scoped `overrides`, а не `legacy-peer-deps` (последний ослабляет проверку peer-зависимостей глобально и маскирует реальные несовместимости). Удалить `overrides` (и эту запись), когда `nestjs-zod` выпустит peer-диапазон под актуальный мажор `@nestjs/*`.

## 5. Уязвимые транзитивные зависимости — `overrides` и ожидание апстрима

**`body-parser` / `multer` — закрыты через `overrides`.** `express` и `@nestjs/platform-express` тянут уязвимые `body-parser` (DoS на сжатом теле с хвостовыми байтами, GHSA-27r3-jxmh-p828 — доступен анонимно на любом JSON-маршруте) и `multer` (DoS при асинхронном `fileFilter`, GHSA-q7qp-rjg7-q26m). В `package.json` добавлены `overrides` для `body-parser` и `multer` на исправленные версии (без смены мажора, совместимы). Удалить оба override (и этот абзац), когда `express`/`@nestjs/platform-express` сами потребуют исправленные версии: `npm audit --omit=dev` без override не должен показывать эти пакеты.

**Транзитивные пакеты `minio` — ждать апстрим.** `npm audit` показывает уязвимости в `stream-json`, `query-string` и `decode-uri-component`, приходящих через `minio`. Исправления выходят только в новых мажорных версиях (у `query-string` — ESM-only) и на момент аудита (2026-10-26) были опубликованы считанные дни назад. Уязвимый код **недостижим** из приложения: из `query-string` `minio` вызывает только `stringify` (уязвимость — в разборе/декодировании), а `stream-json` используется лишь в `listenBucketNotification`, который проект не вызывает. Форсировать мажоры через `overrides` на рантайм-пути загрузок без интеграционных тестов против живого MinIO — риск выше пользы. Удалить этот абзац, когда `minio` обновит транзитивные зависимости. Остальные находки аудита сидят в dev-only-цепочках (jest, tsc-alias) и в рантайм не попадают.

## Инцидент 2026-08-16: OOM на `GET /sermons`

При ~420 проповедях `GET /sermons` без `take` через прежний 8-уровневый `leftJoinAndSelect` давал декартово размножение строк и OOM-убивал контейнер (256 МБ). Исправлено в `SermonService.findAll` переходом на join-свободную страницу + `assembleSermonGraph` (см. [`modules/sermon.md`](./modules/sermon.md)). `GET /playlists` (долг №1) остаётся уязвим по той же причине.

## Артефакты инцидента 2026-08-18: cleanup выполнен (2026-08-18)

См. [`db-search-runbook.md` — Статус выполнения](./db-search-runbook.md#статус-выполнения-2026-08-18).

| Артефакт | Статус |
|----------|--------|
| Docker-volume `slovo-pgdata-utf8` (orphaned blue-green) | Удалён |
| `/root/slovo_prod_20260818.dump` (pre-fix C-locale БД) | Удалён (перед удалением снят свежий верифицированный бэкап) |
| `/slovo/postgres/env-postgres-server.bak-20260818` | Удалён |

Свежий бэкап healthy-БД: `/root/slovo_prod_20260818-postfix.dump` (153 121 байт, 7 TABLE DATA по `pg_restore --list`). Текущая точка восстановления; обновлять при существенных изменениях данных.
