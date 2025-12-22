# Deployment / Releases (develop → beta, main → production)

## TL;DR (как работать без боли)

- Разрабатываем и мерджим фичи в **`develop`** → это автоматически деплоится на **beta**.
- Когда готовы релизиться: делаем PR **`develop` → `main`** (лучше часто и небольшими порциями).
- После релиза: **back-merge `main` → `develop`**, чтобы ветки не “разъезжались” и следующие мерджи были проще.

## CI/CD (GitHub Actions)

Workflow: `.github/workflows/ci-cd.yml`

- **push в `develop`** → деплой в `/opt/memalerts-backend-beta` (порт 3002)
- **push в `main`** → деплой в `/opt/memalerts-backend` (порт 3001)

Технически деплой делает:

- копирование кода на VPS (SCP)
- установка зависимостей (`pnpm install --frozen-lockfile`)
- сборка (`pnpm build`)
- Prisma (`prisma generate`, `prisma migrate deploy`)
- перезапуск через PM2
- (опционально) настройка nginx через `.github/scripts/setup-nginx-full.sh`

Дополнительно:

- включён **`concurrency`** для деплой‑джобов, чтобы при серии пушей не “наезжали” деплои друг на друга (берётся последний).

## Секреты (GitHub Secrets)

Обязательные:

- **`VPS_HOST`**, **`VPS_USER`**, **`VPS_SSH_KEY`**, **`VPS_PORT`**
- **`DATABASE_URL`** (production DB)
- **`JWT_SECRET`**
- **`TWITCH_CLIENT_ID`**, **`TWITCH_CLIENT_SECRET`**, **`TWITCH_EVENTSUB_SECRET`**
- **`WEB_URL`**, **`OVERLAY_URL`**

Рекомендуемые:

- **`DOMAIN`** (например `twitchmemes.ru`)
- **`JWT_SECRET_BETA`** (изоляция cookie/token между beta и production)
- **`BETA_DB_MODE`**: `shared` (по умолчанию) или `separate`
- **`DATABASE_URL_BETA`** (нужен только если `BETA_DB_MODE=separate`)

## Важное про beta DB (режимы shared/separate)

### Режим `shared` (по умолчанию): одна БД на beta и prod

Это режим “один профиль/одни данные, разный функционал”.  
Beta и production смотрят на один `DATABASE_URL`.

Важно: если beta и production используют одну и ту же БД, то миграции, попавшие в `develop`, могут:

- ломать production код **до** релиза (если миграция не обратно‑совместима)
- создавать “сложные” релизы на `main` (когда нужно чинить прод прямо во время деплоя)

Рекомендация для `shared`:

- Делать миграции **только additive / обратно‑совместимые** (expand/contract).
- Избегать drop/rename в одном релизе.

### Режим `separate`: отдельная БД для beta

Если нужно безопасно тестировать схему и данные отдельно, ставьте:

- `BETA_DB_MODE=separate`
- `DATABASE_URL_BETA=...`

Также:

- на production **не включаем `DEBUG_LOGS`**, чтобы не открывать debug‑эндпоинты.

### Если нужно переносить данные из beta в production

Есть скрипт:

```bash
pnpm migrate:beta-to-production
```

Он ожидает:

- `DATABASE_URL` — production
- `DATABASE_URL_BETA` — beta

Сценарий: протестили на beta → в нужный момент переносим часть данных → релизим на `main`.

## Как сделать последующие merge удобными (практика)

### 1) Release PR’ы “маленькими”

Чем меньше PR `develop → main`, тем меньше конфликтов и тем проще откаты.

### 2) Back-merge после каждого релиза

После merge в `main` сразу делайте PR:

- `main → develop`

Так `develop` всегда содержит продовые hotfix’ы/изменения в workflow/конфиге.

### 3) Миграции — только forward и по возможности обратно-совместимые

Хороший паттерн для безопасных релизов:

- **шаг 1:** добавить новое поле/таблицу (без удаления старого), код пишет в оба места или читает с fallback  
- **шаг 2:** после выката удалить старое (отдельным релизом)

### 4) “Продвижение” одного и того же коммита

Чтобы beta и production были максимально одинаковыми:

- выбирайте конкретный commit SHA из `develop`, который “проверен на beta”
- этот SHA должен попасть в `main` через PR без дополнительных коммитов “в последний момент”

## PM2 процессы

- production: `memalerts-api` (порт 3001)
- beta: `memalerts-api-beta` (порт 3002)

## Nginx / домены

Nginx конфиг на сервере ожидает:

- production домен: `DOMAIN`
- beta домен: `beta.DOMAIN`

Скрипт настройки nginx: `.github/scripts/setup-nginx-full.sh` (если он есть на сервере).


