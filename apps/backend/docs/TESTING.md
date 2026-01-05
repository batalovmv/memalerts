## Тесты MemAlerts Backend (что именно мы проверяем)

Этот проект чаще “ломается” не из‑за мелких утилит, а из‑за **инвариантов безопасности / маршрутизации**. Поэтому тесты в первую очередь фиксируют:

- **beta/prod изоляцию**: домены/origins, выбор cookie (`token` vs `token_beta`), поведение auth на beta-домене.
- **CSRF границы**: CSRF включён для `POST/PUT/PATCH/DELETE`, но есть строгие исключения:
  - `/internal/*` (internal relay, localhost-only)
  - `/webhooks/*` (Twitch EventSub и др. вебхуки — HMAC вместо CSRF)
  - `/health`
  - `/auth/twitch*` (backward-compatible auth callback flow)
  - `/public/*`
  - нюанс: в production допускается `POST /auth/logout` без `Origin`, **только если** `Sec-Fetch-Site` = `same-site|same-origin` (см. `src/middleware/csrf.ts`).
- **internal relay**: `/internal/*` доступен только с localhost и требует заголовок `x-memalerts-internal`.
- **Socket.IO комнаты/права**: `join:overlay`, `join:channel`, `join:user`, а также инвариант приватности — `wallet:updated` **только** в `user:{id}`.

Большинство файлов в `tests/*.test.ts` как раз названы по этим инвариантам (CSRF, internal relay, socket join, beta gating и т.д.).

## Быстрый запуск тестов локально

Тесты **не используют** ваш обычный `DATABASE_URL`. Для безопасности нужен отдельный base-url:

- `TEST_DATABASE_URL_BASE` — базовый URL к тестовой БД (без `?schema=`).

Поднять Postgres можно через `docker-compose.test.yml` (порт **5433**):

```bash
docker compose -f docker-compose.test.yml up -d
```

Запуск тестов:

```bash
TEST_DATABASE_URL_BASE="postgresql://postgres:postgres@localhost:5433/memalerts_test" pnpm test
```

Watch-режим:

```bash
TEST_DATABASE_URL_BASE="postgresql://postgres:postgres@localhost:5433/memalerts_test" pnpm test:watch
```

## Как устроена тестовая БД

- Тесты используют **реальный Postgres**.
- На каждый прогон создаётся **уникальная schema** (`TEST_SCHEMA=test_<uuid>`), затем выполняется:
  - `pnpm prisma db push --accept-data-loss` по текущему `prisma/schema.prisma` (см. `tests/globalSetup.ts`).
- После прогона schema удаляется (`DROP SCHEMA ... CASCADE`).

Это даёт изоляцию без необходимости пересоздавать весь контейнер.

Почему `db push`, а не `migrate`:

- История миграций в этом репозитории **не гарантированно “replayable с нуля”** (есть миграции, рассчитанные на pre-existing tables), а для тестов нужна детерминированная сборка схемы “из текущего Prisma schema”.

Полезно для отладки:

- **`TEST_SCHEMA`** можно задать вручную, чтобы переиспользовать одну и ту же schema на несколько прогонов.
- `vitest.config.ts` автоматически генерирует `TEST_SCHEMA` и подставляет `process.env.DATABASE_URL` с `?schema=...`.

## CI (self-hosted runner)

Тесты гоняются в self-hosted workflow: `.github/workflows/ci-cd-selfhosted.yml`.

- Job `test` поднимает Postgres как service (порт **5433**) и выставляет:
  - `NODE_ENV=test`
  - `TEST_DATABASE_URL_BASE=postgresql://postgres:postgres@localhost:5433/memalerts_test`
- Затем выполняется `pnpm test:ci` (это `vitest run`).

Деплой beta/prod в этом workflow зависит от успешного прохождения тестов.


