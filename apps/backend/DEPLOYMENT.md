# Deployment / Releases (main → beta, develop → production)

## TL;DR (как работать без боли)

- Разрабатываем и мерджим фичи в **`main`** → это автоматически деплоится на **beta**.
- Когда готовы релизиться: делаем PR **`main` → `develop`** (лучше часто и небольшими порциями).
- После релиза: **back-merge `develop` → `main`**, чтобы ветки не “разъезжались” и следующие мерджи были проще.

## CI/CD (GitHub Actions)

Workflows:

- `.github/workflows/ci-cd.yml` — PR checks / ручной запуск (GitHub-hosted)
- `.github/workflows/ci-cd-selfhosted.yml` — деплой на VPS через self-hosted runner (почти без GitHub minutes)

- **push в `main`** → деплой в `/opt/memalerts-backend-beta` (порт 3002)
- **tag `prod-*`** → деплой в `/opt/memalerts-backend` (порт 3001)

Технически деплой делает:

- синхронизацию кода в `/opt/...` (rsync на VPS)
- `pnpm install --frozen-lockfile`
- `pnpm build`
- Prisma (`prisma migrate deploy`)
- рестарт через PM2
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

#### Как включить `shared` (для команды)

В GitHub репозитории → **Settings → Secrets and variables → Actions → Secrets**:

- **`BETA_DB_MODE`**: не задавать или поставить `shared`
- **`DATABASE_URL`**: production DB (общая для prod и beta)
- **`DATABASE_URL_BETA`**: не нужен (можно удалить/не заполнять)

Дальше:

- запусти деплой beta (push в `develop` или `Run workflow`)
- проверь, что на beta и main данные совпадают (одинаковые `channel.slug`, мемы, кошельки)

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
- chat bot runner (global): `memalerts-chatbot`
  - запускается **отдельным процессом** (не внутри API)
  - в текущем CI стартуется на **production deploy** и работает сразу на оба инстанса (post → `http://127.0.0.1:3001` и `http://127.0.0.1:3002`)
  - полезно:
    - статус: `pm2 status`
    - логи: `pm2 logs memalerts-chatbot --lines 200`
    - рестарт: `pm2 restart memalerts-chatbot`

- (опционально) YouTube runner: `memalerts-youtube-chatbot`
  - запускается отдельным процессом: `pnpm build && pnpm start:youtube-chatbot`
  - пишет credits chatter события и доставляет outbox для YouTube

- (опционально) VKVideo runner: `memalerts-vkvideo-chatbot`
  - запускается отдельным процессом: `pnpm build && pnpm start:vkvideo-chatbot`
  - слушает VKVideo pubsub и доставляет outbox/команды

## Nginx / домены

Nginx конфиг на сервере ожидает:

- production домен: `DOMAIN`
- beta домен: `beta.DOMAIN`

Скрипт настройки nginx: `.github/scripts/setup-nginx-full.sh` (если он есть на сервере).

## Redis (рекомендовано для масштаба)

Если включить `REDIS_URL`, backend использует Redis **best-effort** для кэшей и (опционально) Socket.IO redis adapter.

Также добавлен Redis-backed rate limit store:

- `RATE_LIMIT_REDIS=1` (по умолчанию включено, если `REDIS_URL` задан)
- `RATE_LIMIT_REDIS=0` — принудительно выключить (останется in-memory store на процесс)

Важно: namespace в Redis автоматически разделяет **prod** и **beta** (по `DOMAIN`/`PORT`), чтобы данные не смешивались.

## Upload storage (local → S3/R2/MinIO)

По умолчанию хранение дедуп-файлов локальное (подходит на старте):

- `UPLOAD_STORAGE=local` → `FileHash.filePath` = `/uploads/memes/{hash}.{ext}`

Для object storage:

- `UPLOAD_STORAGE=s3`
- обязательные env: `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_PUBLIC_BASE_URL`
- опционально: `S3_ENDPOINT` (R2/MinIO), `S3_REGION`, `S3_KEY_PREFIX`, `S3_FORCE_PATH_STYLE`

Рекомендация для прод-выкатов: `S3_PUBLIC_BASE_URL` указывать на CDN/домен раздачи, чтобы URL’ы в БД были стабильны.


