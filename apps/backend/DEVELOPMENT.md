# Development (memalerts-backend)

## Требования

- Node.js 18+ (в CI используется 20)
- pnpm
- PostgreSQL 15+

## Быстрый запуск

```bash
pnpm install
copy ENV.example .env
pnpm prisma migrate dev
pnpm dev
```

По умолчанию API поднимается на `http://localhost:3001` (см. `PORT`).

## Переменные окружения (локально)

Минимально необходимые:

- **`DATABASE_URL`**: `postgresql://user:pass@localhost:5432/memalerts?schema=public`
- **`JWT_SECRET`**
- **`TWITCH_CLIENT_ID`**
- **`TWITCH_CLIENT_SECRET`**
- **`TWITCH_EVENTSUB_SECRET`**

Рекомендуемые:

- **`WEB_URL`**: адрес фронтенда (для CORS), напр. `http://localhost:5173`
- **`OVERLAY_URL`**: адрес overlay (если отдельный), либо тот же `WEB_URL`
- **`DOMAIN`**: домен (в проде), на локалке можно не задавать
- **`TWITCH_CALLBACK_URL`**: redirect URL для Twitch OAuth callback

## Основные команды

```bash
pnpm dev
pnpm build
pnpm start

pnpm db:migrate
pnpm db:push
pnpm db:seed
pnpm db:studio
```

## Как устроены роуты (быстро)

- **`/streamer/*`**: панель стримера (`streamer` или `admin`)
- **`/owner/*`**: операции owner-only (`admin`)

## Frontend рядом

Фронтенд находится в соседней папке `memalerts-frontend`.

Типичный сценарий:

1) поднять backend (`pnpm dev` здесь)  
2) поднять frontend в соседнем репо  
3) указать `WEB_URL=http://localhost:5173` (или какой у вас порт Vite)

## Отладка и диагностика

- `GET /health` — быстрый health-check.
- На beta окружении можно включать `DEBUG_LOGS=1` (см. `DEPLOYMENT.md`), чтобы активировались отладочные хуки.
- Логи: в `src/utils/logger.ts` — структурированный JSON-логгер.

## Практики производительности (что важно не ломать)

- **Не делать sync FS в горячем пути** (`fs.*Sync`): это блокирует event-loop.
- **Ограничивать пагинацию** и payload’ы (поиск/статы уже используют clamp’ы).
- **Короткие транзакции**: не выполнять “внешние” запросы внутри `prisma.$transaction`.
- **Схемные изменения**: для прод‑безопасности делать миграции “в два шага” (см. `DEPLOYMENT.md`).


