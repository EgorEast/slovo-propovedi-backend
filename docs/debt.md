# Технический долг

Реестр «срезанных углов» (TODO/hack/known-issues) и инцидентов. Запись добавляется в том же PR/коммите, что и код, к которому она относится (см. [`README.md`](./README.md), правило 3).

## 1. `GET /playlists` — тот же паттерн full-fetch + deep join

`src/playlist/playlist.service.ts:195-257` — `findAll` использует тот же full-fetch + 6-уровневый `leftJoinAndSelect` (deep relation graph), который приводил к OOM на `GET /sermons` (см. инцидент ниже). Пока каталог небольшой — терпимо, но до роста каталога нужен тот же рефакторинг, что и в `SermonService.findAll`: join-свободная страница + линейная сборка графа.

## 2. `GET /health` — no-op

`src/health/health.controller.ts` возвращает `{ status: 'ok' }` без единой проверки зависимостей (БД, MinIO). Во время инцидента 2026-08-16 это — слепое пятно мониторинга: health был «зелёным», пока приложение фактически не отвечало (OOM). Нужна реальная проверка живости.

## 3. `assembleSermonGraph` — torn-read окно между линейными запросами

`SermonService.assembleSermonGraph` собирает граф из нескольких последовательных SELECT-запросов без единого снимка (snapshot): конкурентный DELETE с FK-CASCADE между запросом 1 (join-ы страницы) и запросом 2 (плейлисты) даст висячий join и fail-fast 500 вместо устаревших данных. Окно — миллисекунды, трафик админ-масштаба, поэтому решение принято осознанно (fail-fast на пропавшем родителе вместо REPEATABLE READ-транзакции). Будущее средство — обернуть чтение графа в транзакцию с уровнем изоляции REPEATABLE READ.

## Инцидент 2026-08-16: OOM на `GET /sermons`

При ~420 проповедях `GET /sermons` без `take` через прежний 8-уровневый `leftJoinAndSelect` давал декартово размножение строк и OOM-убивал контейнер (256 МБ). Исправлено в `SermonService.findAll` переходом на join-свободную страницу + `assembleSermonGraph` (см. [`modules/sermon.md`](./modules/sermon.md)). `GET /playlists` (долг №1) остаётся уязвим по той же причине.
