# Runbook: регистронезависимый поиск по кириллице (sermons / playlists)

**Дата:** 2026-08-18
**Слой:** backend (database / deployment)
**Статус:** инцидент-релевантный

Поиск по `GET /sermons?search=...` и `GET /playlists?search=...` в проде **регистрозависим**:
`Христос` находит 18 результатов, `христос` и `ХРИСТОС` — 0. Поиск должен быть
регистронезависимым для кириллицы.

> Ключевой факт: API не отдаёт версию (`GET /health` = `{"status":"ok"}`). Версию
> контейнера можно определить только через Docker.

---

## 1. Симптом

| Эндпоинт | Запрос | Результат |
|-----------|--------|-----------|
| `GET /sermons?search=Христос` | верный регистр | 18 |
| `GET /sermons?search=христос` | нижний регистр | 0 |
| `GET /sermons?search=ХРИСТОС` | верхний регистр | 0 |
| `GET /playlists?search=Христос` | верный регистр | > 0 |
| `GET /playlists?search=христос` | нижний регистр | 0 |
| `GET /playlists?search=ХРИСТОС` | верхний регистр | 0 |

Проблема одинакова **для проповедей** на всех ветках пагинации (offset `page/limit`,
full-fetch, keyset `take/cursor`) — общее условие поиска едино. Для плейлистов
регистрозависимость наблюдается на тех ветках, где плейлист-поиск существует
(≥ v0.7.0); keyset-ветка (`take/cursor`) для плейлистов не реализована
(см. `find-all-playlists-query.dto.ts`).

---

## 2. Диагностика (пошагово)

### 2a. Какой контейнер крутится

```bash
# ID и image-тег текущего контейнера
docker ps --format '{{.Names}}\t{{.Image}}\t{{.Status}}'

# или подробнее
docker inspect <container_id> --format '{{.Config.Image}}'
```

Сверить выведенный тег с таблицей коммитов:

| Тег | Дата | Что принципиально |
|-----|------|-------------------|
| ≤ v0.3.x | 08-13–08-14 | `ILIKE` для поиска (нет FTS) |
| v0.4.x–v0.6.x | 08-14–08-15 | sermon FTS, запрос к `sermon.search_vector`, требует миграцию 005 (иначе 500 на каждом поиске проповедей); плейлист-поиск отсутствует |
| v0.7.0–v0.8.x | 08-16–08-17 | + playlist FTS (commit f5891a4, с рождения — LOWER-LIKE для плейлистов никогда не существовал), требует 005+006 |
| v0.9.0 | 08-17 | HEAD (commit 667671b) |

> ⚠️ Если тег неизвестен или нестандартный — перейти к psql-диагностике ниже.

### 2b. Проверки в PostgreSQL (psql)

Все команды — как DB-owner. Подключение:

```bash
psql -h <host> -U <user> -d slovo_prod
```

**2b-1. Кодировка и локаль кластера:**

```sql
SHOW server_encoding;
SHOW lc_ctype;
SELECT datcollate, datctype FROM pg_database WHERE datname = current_database();
```

**2b-2. Поведение `lower()` на кириллице:**

```sql
SELECT lower('Христос');
-- Если вернул 'Христос' (без изменений) → LC_CTYPE=C/POSIX → кириллический case folding сломан
-- Если вернул 'христос' → UTF-8 локаль работает
```

**2b-3. Проверка FTS (to_tsvector):**

```sql
SELECT to_tsvector('russian', 'Христос христос');
-- Если лексемы == {'христос'} (нижний регистр, стемминг) → FTS работает
-- Если лексемы содержат 'Христос' без свёртки → кодировка SQL_ASCII (stemmer fallback на simple)
```

**2b-4. Наличие колонок `search_vector`:**

```sql
\d sermon
\d playlist
```

Искомое: колонка `search_vector` типа `tsvector` и индексы `IDX_sermon_search_vector`,
`IDX_playlist_search_vector`.

**2b-5. Индексы:**

```sql
SELECT indexname FROM pg_indexes
WHERE tablename IN ('sermon', 'playlist')
  AND indexname LIKE '%search_vector%';
```

### 2c. Матрица интерпретации

| Контейнер | search_vector есть? | lower('Христос') | to_tsvector приводит? | Диагноз |
|-----------|---------------------|-------------------|----------------------|---------|
| < v0.4.0 | нет | — | — | **Старый образ.** Playlist-поиск не существовал; sermon — на `ILIKE`/`LOWER`. Решение: деплой ≥ v0.4.0 + миграция 005 (или ≥ v0.9.0 + миграции 005+006). |
| v0.4.x–v0.6.x | нет (sermon FTS есть, но колонка `search_vector` отсутствует) | — | — | **Код sermon FTS есть, миграция 005 НЕ применена.** Все запросы поиска проповедей 500 (`column "search_vector" does not exist`). Решение: применить миграцию 005. |
| v0.7.0–v0.8.x | нет (playlist) / да (sermon) | — | — | **Смешанный образ.** Playlist-FTS не применена; плейлист-поиск 500 (код обращается к `playlist.search_vector`, которого нет). Решение: миграция 006 (без перевыпуска образа). |
| ≥ v0.9.0 | **нет** | — | — | **Миграции 005/006 НЕ применены** (docs/db.md может ошибочно значить их как применённые). Решение: применить 005+006 (идемпотентны). |
| ≥ v0.9.0 | да | `Христос` (без изменений) | — | **LC_CTYPE=C/POSIX**, кодировка не SQL_ASCII. FTS через `to_tsvector('russian')` **должен** работать → проверить `to_tsvector` (пункт 2b-3). Если лексемы приводятся — проблема в коде приложения. |
| ≥ v0.9.0 | да | `христос` | лексемы приводятся | **Всё в порядке** → проблема в deployed-образе (stale build). Пересобрать и задеплоить v0.9.0. |
| ≥ v0.9.0 | да | `христос` | лексемы **НЕ** приводятся | **Кодировка SQL_ASCII**. `to_tsvector('russian')` fallback-ит на `simple` dictionary (нет русского стемминга). Решение: переезд кластера на UTF-8 (см. раздел 4). |

---

## 3. Решение A — деплой актуальной версии (приоритет)

Порядок действий строго определён: **сначала миграции, потом образ**.

### Шаг 1. Применить миграции 005 и 006

```bash
psql -h <host> -U <user> -d slovo_prod -f sql/migrations/005_sermon_search_tsvector.sql
psql -h <host> -U <user> -d slovo_prod -f sql/migrations/006_playlist_search_tsvector.sql
```

Обе миграции **идемпотентны** (`ADD COLUMN IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS`):
повторный запуск — no-op, безопасно. Но включают `ACCESS EXCLUSIVE` lock + пересборку
таблицы (для `GENERATED ... STORED`). При ~862 проповедях и ~50 плейлистах (оценка) — секунды.

### Шаг 2. Проверить наличие колонок и индексов

```sql
\d sermon   -- ищем search_vector tsvector + IDX_sermon_search_vector
\d playlist -- ищем search_vector tsvector + IDX_playlist_search_vector
```

### Шаг 3. Деплой v0.9.0

Тег `v0.9.0` уже существует локально и на origin (HEAD == tag). Создание
дублирующего тега или повторный `git push` тега **не** перезапустит
`release.yml` (workflow срабатывает только при появлении **нового** тега
`v*`). Варианты:

**Вариант A — повторный запуск workflow в Forgejo UI:**

1. Открыть **Actions → release.yml** → **Run workflow** (или перезапустить завершённый run).
2. Workflow соберёт образ и задеплоит на VPS.

**Вариант B — новый релиз:**

```bash
npm run bump-version <new_ver>   # создаёт тег v<new_ver>, коммитит, пушит
# release.yml → vps-deploy.sh → Docker build + systemd restart
```

**Ручной деплой на VPS** (без CI):

```bash
docker buildx build -t slovo-propovedi-backend:v0.9.0 .
systemctl restart slovo-backend.service
```

> **КРИТИЧЕСКОЕ ПРЕДУПРЕЖДЕНИЕ:** деплой v0.9.0 **БЕЗ** предварительно применённых
> миграций 005/006 = 500 на **всех** запросах поиска. Код v0.9.0 обращается к колонке
> `search_vector`, которой нет — `column "search_vector" does not exist`. Убедитесь
> в пункте 2, прежде чем деплоить.

### Шаг 4. Пост-деплойная проверка

См. раздел 6 «Чеклист верификации».

---

## 4. Решение Б — переезд кластера на UTF-8 локаль (рекомендуется)

Решение A исправляет симптом (FTS не зависит от ctype). Решение Б устраняет корень:
`ILIKE` и `lower()` начинают нормально работать на кириллице. Рекомендуется как для гигиены кластера, так и для предотвращения других locale-зависимых проблем.

> Основано на `sql/migrations/004_fix_db_collation.md`.

### Шаг 1. Дамп текущей БД

```bash
pg_dump -Fc -h <host> -U <user> -d slovo_prod -f slovo_prod.dump
# pg_dump -Fc создаёт custom-формат (сжатый, параллельный restore)
```

**Ворота проверки:** перед уничтожением единственной копии(prod данных
убедитесь, что дамп валиден:

```bash
pg_restore --list slovo_prod.dump | head -20
# Должен вывести список объектов (tbl, seq, idx…). Если ошибка — дамп битый,
# повторить pg_dump.
```

### Шаг 2. Пересоздать data-каталог с UTF-8 локалью

**Остановить старый кластер** (иначе data-каталог заблокирован):

```bash
docker stop <postgres_container>
# или: systemctl stop postgresql
```

Вариант A — Docker (POSTGRES_INITDB_ARGS):

```bash
docker run -d \
  -e POSTGRES_PASSWORD=... \
  -e POSTGRES_DB=slovo_prod \
  -e POSTGRES_INITDB_ARGS="--locale=ru_RU.UTF-8" \
  -v pgdata:/var/lib/postgresql/data \
  postgres:16-alpine
```

> Если alpine не содержит `ru_RU.UTF-8`, используйте `en_US.UTF-8` — для
> кириллического case folding подходит любой UTF-8 ctype.

Вариант B — ручной initdb:

```bash
initdb -D /var/lib/postgresql/data --encoding=UTF8 --locale=ru_RU.UTF-8
```

> ⚠️ `--locale` применяется **только** при первой инициализации data-каталога.
> Повторный запуск с `POSTGRES_INITDB_ARGS` на существующем каталоге — no-op.

### Шаг 3. Восстановить данные

```bash
pg_restore -d slovo_prod slovo_prod.dump
```

### Шаг 4. Применить все миграции (001–007)

```bash
psql -h <host> -U <user> -d slovo_prod -f sql/migrate-add-username.sql
psql -h <host> -U <user> -d slovo_prod -f sql/migrations/001_add_positions.sql
psql -h <host> -U <user> -d slovo_prod -f sql/migrations/002_add_user_roles.sql
psql -h <host> -U <user> -d slovo_prod -f sql/migrations/003_revoked_refresh_tokens.sql
psql -h <host> -U <user> -d slovo_prod -f sql/migrations/005_sermon_search_tsvector.sql
psql -h <host> -U <user> -d slovo_prod -f sql/migrations/006_playlist_search_tsvector.sql
psql -h <host> -U <user> -d slovo_prod -f sql/migrations/007_chapter_range.sql
```

### Шаг 5. Проверка после переезда

```sql
SELECT datcollate, datctype FROM pg_database WHERE datname = current_database();
-- Ожидаемое: en_US.utf8 или ru_RU.utf8, НЕ C/POSIX

SELECT lower('Христос');
-- Ожидаемое: 'христос'

SELECT 'Благодать' ILIKE '%благодать%';
-- Ожидаемое: t
```

---

## 5. Замечания по безопасности миграций

| Миграция | Тип | Безопасность |
|----------|-----|--------------|
| 005 `sermon_search_tsvector` | ADD COLUMN + CREATE INDEX | **Идемпотентна.** `IF NOT EXISTS` на обоих шагах. Повторный запуск — no-op. Таблица пересобирается (GENERATED STORED), но при ~862 строках — секунды. `ACCESS EXCLUSIVE` lock — минимальный риск при одном операторе. |
| 006 `playlist_search_tsvector` | ADD COLUMN + CREATE INDEX | **Идемпотентна.** Аналогично 005. Аналогичные lock-и и стоимость. |
| 007 `chapter_range` | ALTER COLUMN TYPE (integer → json) | **НЕОБРАТИМАЯ** (reversible через ручной `ALTER COLUMN ... TYPE integer USING ...`, но падает на строках с JSON-массивом). DO-блок с guard по `information_schema` делает повторный запуск идемпотентным (no-op), но **первый** запуск деструктивен. Не перезапускать без необходимости. |

> ⚠️ Применение миграций — **только** через `psql` от имени DB-owner.
> Автоматического runner'а нет (см. [`db.md`](./db.md)).

---

## 6. Чеклист верификации после фикса

Все проверки — через curl или браузер. Сервер должен отвечать 200 OK.

### 6a. Sermons — поиск по трем регистрам

```bash
# Верный регистр
curl -s 'https://<api>/sermons?search=%D0%A5%D1%80%D0%B8%D1%81%D1%82%D0%BE%D1%81' | jq '.count'
# Нижний регистр
curl -s 'https://<api>/sermons?search=%D1%85%D1%80%D0%B8%D1%81%D1%82%D0%BE%D1%81' | jq '.count'
# Верхний регистр
curl -s 'https://<api>/sermons?search=%D0%A5%D0%A0%D0%98%D0%A1%D0%A2%D0%9E%D0%A1' | jq '.count'
```

> URL-коды: `Христос`, `христос`, `ХРИСТОС`. Вставлять как query-параметр.

**Ожидаемое:** все три запроса возвращают одинаковый ненулевой `count`.

### 6b. Playlists — поиск по трем регистрам

```bash
# Верный регистр
curl -s 'https://<api>/playlists?search=%D0%A5%D1%80%D0%B8%D1%81%D1%82%D0%BE%D1%81' | jq '.count'
# Нижний регистр
curl -s 'https://<api>/playlists?search=%D1%85%D1%80%D0%B8%D1%81%D1%82%D0%BE%D1%81' | jq '.count'
# Верхний регистр
curl -s 'https://<api>/playlists?search=%D0%A5%D0%A0%D0%98%D0%A1%D0%A2%D0%9E%D0%A1' | jq '.count'
```

**Ожидаемое:** все три запроса возвращают одинаковый ненулевой `count`.

### 6c. Обе ветки пагинации

```bash
# Offset-пагинация (page/limit)
curl -s 'https://<api>/sermons?search=христос&page=1&limit=10' | jq '.count'

# Keyset-пагинация (take/cursor)
curl -s 'https://<api>/sermons?search=христос&take=10' | jq '.sermons | length'
```

**Ожидаемое:** `count > 0` (offset) и `sermons` непустой массив (keyset).

### 6d. Контрольная точка — полная проверка

```bash
API="https://<api>"
for q in "%D0%A5%D1%80%D0%B8%D1%81%D1%82%D0%BE%D1%81" "%D1%85%D1%80%D0%B8%D1%81%D1%82%D0%BE%D1%81" "%D0%A5%D0%A0%D0%98%D0%A1%D0%A2%D0%9E%D0%A1"; do
  echo -n "search=$q: "
  curl -s "$API/sermons?search=$q" | jq -r '.count'
done
```

Все три строки должны вывести одно и то же число > 0.

---

## Связанные документы

- [`db.md`](./db.md) — схема БД, список миграций, команды применения
- [`sql/migrations/004_fix_db_collation.md`](../sql/migrations/004_fix_db_collation.md) — локаль (collation/ctype) БД и пересоздание кластера
- [`sql/migrations/005_sermon_search_tsvector.sql`](../sql/migrations/005_sermon_search_tsvector.sql) — FTS-индекс проповедей
- [`sql/migrations/006_playlist_search_tsvector.sql`](../sql/migrations/006_playlist_search_tsvector.sql) — FTS-индекс плейлистов
- [`sql/migrations/007_chapter_range.sql`](../sql/migrations/007_chapter_range.sql) — изменение типа `chapter` (НЕОБРАТИМОЕ)
- [`modules/sermon.md`](./modules/sermon.md) — поиск проповедей
- [`modules/playlist.md`](./modules/playlist.md) — поиск плейлистов
- [`debt.md`](./debt.md) — реестр технического долга и инцидентов
