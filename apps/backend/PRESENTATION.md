# MemAlerts (Backend) — презентация pet‑проекта

MemAlerts — backend для сервиса “мемы на стриме”: зрители активируют мемы за внутреннюю валюту/поинты, а стример получает **OBS overlay** (мем‑оверлей + credits) и **панель управления**.

## Что умеет (коротко)

- **Auth / аккаунты**: OAuth логин (Twitch) + привязка доп. аккаунтов (YouTube/VK/VK Video) под единого пользователя; роли `viewer / streamer / admin`.
- **Мемы**: каталог мемов канала + активации (очередь, статусы, статистика).
- **Submissions и модерация**: загрузка видео‑мемов → очередь модерации → approve/reject/needs_changes + ресабмиты.
- **Экономика**: кошельки “пользователь × канал”, списания/начисления, промо‑скидки.
- **Realtime**: Socket.IO события в overlay и в панель (активации, обновления кошелька, события сабмишенов).
- **Credits overlay**: отдельный overlay для OBS (донаты/чаттеры), состояние/тикер, events от воркеров.

## Что можно показать на демо (без исходников)

- **Сценарий 1 (зритель)**: войти → открыть страницу канала → активировать мем → увидеть, как событие ушло в realtime (очередь/overlay).
- **Сценарий 2 (стример)**: открыть панель → выдать overlay token → подключить OBS browser source → увидеть `activation:new`/`overlay:config`.
- **Сценарий 3 (moderation)**: загрузить submission → сменить статус (approve/needs_changes) → увидеть realtime событие.
- **Сценарий 4 (credits)**: открыть credits overlay → принять credits events → увидеть обновление state.

## Архитектура (в 7 строк)

- **HTTP API**: Express (`src/index.ts`, `src/routes/*`, `src/controllers/*`)
- **Realtime**: Socket.IO (`src/socket/*`) + комнаты `channel:{slugLower}` и `user:{userId}`
- **DB**: PostgreSQL через Prisma (`prisma/schema.prisma`, `src/lib/prisma.ts`)
- **Uploads**: storage provider (local или S3‑compatible) + дедуп по SHA‑256 (`FileHash`)
- **Воркеры**: отдельные раннеры для чат‑ботов/интеграций (Twitch/YouTube/VKVideo)
- **Инстансы окружений**: изоляция окружений (cookies/CORS) + internal relay между инстансами (localhost only)
- **Наблюдаемость**: структурированные JSON‑логи + requestId

## Технологии

- **Node.js + TypeScript (ESM)**
- **Express**, **Socket.IO**
- **Prisma + PostgreSQL**
- **pnpm**
- **(Опционально) Redis**: cache/rate‑limit store/Socket.IO adapter

## Безопасность и надёжность (то, что я продумывал)

- **JWT в httpOnly cookies**, RBAC по ролям, разделение public/auth endpoints.
- **CSRF + CORS**, строгая изоляция окружений.
- **Rate limiting**: глобальные и точечные лимитеры.
- **Uploads**: лимиты (размер/длительность), проверка контента (anti‑spoofing), защита от path traversal, дедуп по SHA‑256.
- **Webhooks (Twitch EventSub)**: HMAC проверка + защита от replay.
- **Realtime приватность**: персональные события (например кошелёк) идут только в `user:{userId}`.

## CI/CD и эксплуатация (high level)

- Автосборка и деплой (install → build → migrate → restart).
- Сборка: `tsc` → `dist/`, запуск через процесс‑менеджер.
- Миграции: стратегия “expand/contract” для безопасных релизов.

## Что дальше (идеи развития)

- Платёжка/подписки для gated‑фич (entitlements).
- Больше провайдеров OAuth и расширение интеграций чат‑ботов.
- Нагрузочные тесты + метрики (Prometheus/Grafana) и алерты.
- Улучшение модерации (batch actions, аудит, advanced фильтры).


