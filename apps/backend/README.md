# MemAlerts Backend

[![codecov](https://codecov.io/gh/batalovmv/memalerts-backend/branch/main/graph/badge.svg)](https://codecov.io/gh/batalovmv/memalerts-backend)

Backend API для MemAlerts: активация мемов через Twitch Channel Points, overlay для OBS и панель стримера.  
Стек: **Express + Socket.IO + Prisma/PostgreSQL**, деплой через **GitHub Actions** на VPS.

## Что внутри

- **OAuth + сессия**: Twitch OAuth 2.0, JWT в httpOnly cookies, роли `viewer/streamer/admin`.
- **Мемы и модерация**: submissions → approve/reject → approved мемы.
- **Экономика**: кошельки по пользователю+каналу, списания/начисления, промо‑скидки.
- **Realtime**: события в overlay и живые обновления кошелька через Socket.IO.
- **Performance**: rollup-таблицы для статов/популярности, кэши (ETag/304 + Redis опционально), ограничения на пагинацию.
- **Uploads**: дедуп по SHA‑256, хранение через storage provider (**local** сейчас, **S3/R2/MinIO** при необходимости).
- **Безопасность**: CSRF, CORS (изоляция beta/prod), rate limit, проверка контента файлов, HMAC для EventSub.

## Документация (4 файла)

- **`README.md`** — этот файл (кратко и презентабельно)
- **`ARCHITECTURE.md`** — архитектура, потоки, модель доступа, performance notes
- **`DEVELOPMENT.md`** — локальная разработка и интеграция с фронтендом
- **`DEPLOYMENT.md`** — CI/CD, окружения, ветки/релизы и “как деплоить без боли”

Дополнительно (см. `docs/`):

- **`docs/AI_MEME_ANALYSIS.md`** — подробная документация текущей реализации AI‑анализа мемов (video+audio → title/tags/description), дедупа и хранения результатов
- **`docs/API_ERRORS.md`** — единый контракт ошибок API (`errorCode` + `requestId` + shape)

## AI очередь (кратко)

- `aiStatus`: pending → processing → done/failed (failed = финальное состояние)
- Ретраи с backoff, попытки ограничены `AI_MAX_RETRIES`
- Lock с TTL (`aiLockedBy`, `aiLockExpiresAt`), watchdog: `npm run ai:watchdog:once`

## Быстрый старт (локально)

**Требования:** Node.js 18+ (в CI используется 20), pnpm, PostgreSQL 15+.

```bash
docker compose up -d

pnpm install

# создай .env (см. DEVELOPMENT.md)
copy .env.example .env

pnpm prisma migrate dev
pnpm db:seed
pnpm dev
```

API поднимется на `http://localhost:3001`, health-check: `GET /health`.

## API документация

- Swagger UI: `http://localhost:3001/docs`
- OpenAPI JSON: `http://localhost:3001/docs/openapi.json`
- Версионирование: текущий API считается **v1**. Эндпоинты доступны без префикса и через `/v1/*` (предпочтительно для новых интеграций).

## Devcontainer (VS Code)

Если используешь Dev Containers, конфиг лежит в `.devcontainer/`:

```bash
docker compose up -d
```

Далее открывай репозиторий через **Dev Containers: Reopen in Container**.

## E2E тест (viewer отправляет мем → streamer получает realtime)

Тест не ходит во внешние OAuth‑провайдеры: использует **test-only** эндпоинт `POST /test/login` (доступен только при `NODE_ENV=test`), делает **multipart upload** на `/submissions` с `Origin` (CSRF) и проверяет **Socket.IO** событие `submission:created`.

```bash
pnpm e2e
```

## Окружения (beta / production)

- **`develop` → beta** (поддомен `beta.*`, порт 3002)
- **`main` → production** (основной домен, порт 3001)

Важно: детали и рекомендации по безопасным миграциям/мерджам — в `DEPLOYMENT.md`.
