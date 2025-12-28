## Тесты MemAlerts Backend (что именно мы проверяем)

Этот проект “ломается” не из‑за мелких функций, а из‑за **инвариантов безопасности и маршрутизации**:
- **beta/prod изоляция** (origins/cookies/JWT secrets)
- **CSRF границы** (строгие исключения только для `/internal/*`, `/webhooks/*`, `/health`, `/auth/twitch*`, `/public/*`)
- **internal relay** (только localhost + `x-memalerts-internal`)
- **Socket.IO комнаты/права** и приватность (`wallet:updated` только в `user:{id}`)

Именно эти вещи покрыты первыми тестами.

## Как устроена тестовая БД

- Тесты используют **реальный Postgres**.
- На каждый прогон создаётся **уникальная schema** (`TEST_SCHEMA=test_<uuid>`), затем выполняется `prisma db push` по текущему `schema.prisma`.
- После прогона schema удаляется (`DROP SCHEMA ... CASCADE`).

Это даёт изоляцию без необходимости пересоздавать весь контейнер.

## CI (self-hosted runner)

Тесты рассчитаны на запуск **через CI/CD** на self-hosted runner (VPS).

- Workflow поднимает Postgres как service (порт **5433**) и выполняет:
  - `cd "$GITHUB_WORKSPACE"; pnpm test:ci`
- Деплой (beta/prod) зависит от успешного прохождения тестов.


