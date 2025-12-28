## Тесты MemAlerts Backend (что именно мы проверяем)

Этот проект “ломается” не из‑за мелких функций, а из‑за **инвариантов безопасности и маршрутизации**:
- **beta/prod изоляция** (origins/cookies/JWT secrets)
- **CSRF границы** (строгие исключения только для `/internal/*`, `/webhooks/*`, `/health`, `/auth/twitch*`, `/public/*`)
- **internal relay** (только localhost + `x-memalerts-internal`)
- **Socket.IO комнаты/права** и приватность (`wallet:updated` только в `user:{id}`)

Именно эти вещи покрыты первыми тестами.

## Как устроена тестовая БД

- Тесты используют **реальный Postgres**.
- На каждый прогон создаётся **уникальная schema** (`TEST_SCHEMA=test_<uuid>`), затем выполняется `prisma migrate deploy`.
- После прогона schema удаляется (`DROP SCHEMA ... CASCADE`).

Это даёт изоляцию без необходимости пересоздавать весь контейнер.

## Локальный запуск

Поднять Postgres для тестов:

- `docker compose -f docker-compose.test.yml up -d`

Запустить тесты:

- `TEST_DATABASE_URL_BASE="postgresql://postgres:postgres@localhost:5433/memalerts_test" pnpm test`

Примечания:
- `JWT_SECRET` в тестах имеет дефолт (`test_jwt_secret`), но можно переопределить при необходимости.

## CI (self-hosted runner)

Workflow запускает Postgres как service (порт **5433**) и выполняет `pnpm test:ci`.
Деплой (beta/prod) должен зависеть от успешного прохождения тестов.


