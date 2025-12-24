# MemAlerts Backend

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

## Быстрый старт (локально)

**Требования:** Node.js 18+ (в CI используется 20), pnpm, PostgreSQL 15+.

```bash
pnpm install

# создай .env (см. DEVELOPMENT.md)
copy ENV.example .env

pnpm prisma migrate dev
pnpm dev
```

API поднимется на `http://localhost:3001`, health-check: `GET /health`.

## Окружения (beta / production)

- **`develop` → beta** (поддомен `beta.*`, порт 3002)
- **`main` → production** (основной домен, порт 3001)

Важно: детали и рекомендации по безопасным миграциям/мерджам — в `DEPLOYMENT.md`.
