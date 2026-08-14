# Миграция 004: локаль (collation/ctype) БД для регистронезависимого поиска по кириллице (2026-08-14)

## Проблема

Поиск проповедей (`GET /sermons?search=...`) должен быть регистронезависимым для кириллицы:
`благодать` должен находить `Благодать`.

До этого фикса сравнение шло через `ILIKE`. `ILIKE` сбрасывает регистр ровно настолько,
насколько это умеет **ctype** базы. Если БД создана с `LC_CTYPE=C` (или `POSIX`),
кириллический case folding **не происходит**: ни `ILIKE`, ни даже `lower()` не переводят
`'Благодать'` → `'благодать'` (см. диагностику ниже).

Исправление в коде (тот же коммит) — `LOWER(колонка) LIKE :q` с паттерном, приведённым
к нижнему регистру на границе (`escapeLike(search).toLowerCase()` в JS): работает при
**любой** UTF-8-локали (ru_RU.UTF-8, en_US.UTF-8, ICU). При `LC_CTYPE=C` этого
недостаточно — `lower()` в БД тоже не умеет кириллицу. **Долговременный фикс — локаль БД.**

## Диагностика

Проверить текущую локаль и поведение:

```sql
SELECT datcollate, datctype FROM pg_database WHERE datname = current_database();
SELECT 'Благодать' ILIKE '%благодать%' AS ilike_probe,
       lower('Благодать')               AS lower_probe;
SELECT version();
```

Ожидаемо на **C/POSIX** ctype (сломанный случай):

```
 datctype | ilike_probe | lower_probe
----------+-------------+-------------
 C        | f           | Благодать
```

Ожидаемо на **UTF-8** ctype (рабочий случай):

```
 datctype    | ilike_probe | lower_probe
-------------+-------------+-------------
 en_US.utf8  | t           | благодать
```

## Фикс (требование к провижионингу БД)

База должна создаваться с UTF-8-локалью, умеющей кириллический case folding
(`ru_RU.UTF-8`, `en_US.UTF-8` и т.п.). Локаль задаётся **при инициализации кластера**
(`initdb`) и **не может** быть изменена на лету — `ALTER DATABASE` меняет только
collation-дефолты, но **не** ctype существующего кластера (история: PostgreSQL не
позволяет `ALTER DATABASE ... SET LC_CTYPE`).

### Вариант 1 — официальный образ postgres (Docker)

```bash
docker run -d \
  -e POSTGRES_PASSWORD=... \
  -e POSTGRES_DB=db \
  -e POSTGRES_INITDB_ARGS="--locale=ru_RU.UTF-8" \
  postgres:16-alpine
```

Если образ не содержит нужной локали (alpine часто ограничен), можно использовать
`en_US.utf8` — для кириллического case folding подходит любой UTF-8 ctype.

### Вариант 2 — initdb вручную

```bash
initdb -D /var/lib/postgresql/data --locale=ru_RU.UTF-8
# или
initdb -D /var/lib/postgresql/data --locale=en_US.UTF-8
```

### Вариант 3 — уже существующая БД с C/POSIX ctype

Коллация/ctype существующего кластера в PostgreSQL 16 изменить нельзя — требуется
**пересоздание** с дампом:

```bash
pg_dump -Fc -d db -f db.dump
# остановить БД, пересоздать data-каталог с --locale=ru_RU.UTF-8
pg_restore -d db db.dump
```

> ⚠️ `--locale` применяется только на **первой** инициализации data-каталога.
> Повторный запуск с новым `POSTGRES_INITDB_ARGS` на существующем каталоге —
> no-op, локаль не изменится.

## Проверка после фикса

```sql
SELECT datcollate, datctype FROM pg_database WHERE datname = current_database();
-- ожидаем UTF-8 локаль, НЕ C/POSIX
SELECT 'Благодать' ILIKE '%благодать%';  -- ожидаем t
SELECT lower('Благодать');               -- ожидаем 'благодать'
```

## Связанные документы

- `docs/modules/sermon.md` — поведение поиска `findAll(search)`
- `docs/db.md` — схема БД и список миграций
