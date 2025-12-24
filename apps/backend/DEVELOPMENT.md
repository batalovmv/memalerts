# Development (memalerts-backend)

## Требования

- Node.js 20+
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

## Performance / scaling knobs (полезно знать заранее)

### Uploads: ограничение нагрузки (CPU/IO)

- **`VIDEO_FFPROBE_CONCURRENCY`**: сколько параллельных ffprobe допускаем (по умолчанию ограничено).
- **`FILE_HASH_CONCURRENCY`**: сколько параллельных SHA‑256 hashing допускаем.

### Лимиты body для защиты памяти

Uploads идут через multipart (multer) и не зависят от JSON-limit’ов, поэтому JSON лучше держать небольшим:

- **`JSON_BODY_LIMIT`** (default: `1mb` в prod)
- **`URLENCODED_BODY_LIMIT`** (default: `1mb` в prod)

### Redis (опционально, но рекомендовано для масштаба)

- **`REDIS_URL`**: включает Redis-кэш (best-effort) и Socket.IO adapter (опционально).
- **`RATE_LIMIT_REDIS`**: если `REDIS_URL` задан, делает rate limit консистентным между процессами/инстансами.

### Storage (hybrid local → S3)

- **`UPLOAD_STORAGE=local|s3`**: куда кладём дедуп-файлы (`FileHash.filePath` хранит публичный путь/URL).
- Для `s3` см. `ENV.example` (переменные `S3_*`).

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

## Shared DB (beta + prod): как безопасно жить с недельным отрывом develop→main

Если beta (`develop`) может быть впереди `main` на дни/неделю, то база данных должна быть **обратно-совместимой** для старого прод-кода.

### Правило миграций (expand/contract)

- **Expand (разрешено, пока main не догнал)**:
  - добавлять новые таблицы/колонки (`ADD COLUMN ... NULL` или `ADD COLUMN ... NOT NULL DEFAULT ...`)
  - добавлять индексы/constraints (если не ломает старые данные)
- **Contract (только после релиза в main)**:
  - удалять старые колонки/таблицы
  - переименования/изменения типов — только после периода совместимости

### Что считается “опасным” (destructive) для shared DB

- `DROP TABLE`, `DROP COLUMN`
- `ALTER COLUMN ... TYPE`
- `RENAME COLUMN/TABLE`
- `ALTER COLUMN ... SET NOT NULL` (если нет гарантированного backfill’а)

В CI включён guard: `pnpm migrations:check` — он падает, если в **новых/изменённых** миграциях есть destructive SQL.

### Soft-delete вместо физического удаления

Для сущностей, которые пользователь ожидает видеть одинаково на beta/prod, безопаснее делать **soft-delete** (например `deletedAt`), чем `DELETE`.
Это снижает риск, что старый прод-код “не ожидает” исчезновения строк и ломает UX/статы.

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


