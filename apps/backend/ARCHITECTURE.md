# MemAlerts Backend — архитектура

Этот документ описывает текущую архитектуру backend’а и основные взаимодействия модулей.  
Repo: `memalerts-backend` (**Express + Socket.IO + Prisma/PostgreSQL**).

## Цели и принципы

- **Обратная совместимость**: существующие клиенты/роуты не должны ломаться.
- **Безопасность**: все входы считаем недоверенными; строгая валидация; least-privilege.
- **Производительность**: короткие транзакции, предсказуемые запросы, лимиты на пагинацию, кэш где возможно.
- **Realtime корректность**: разделение публичных/персональных событий, минимальные payload’ы.

## Высокоуровневые компоненты

- **HTTP API (Express)**: auth, viewer, streamer/owner панель, webhooks.
- **Realtime (Socket.IO)**: overlay + обновления состояния (активации, кошелёк, submissions).
- **DB (PostgreSQL через Prisma)**: source of truth (users/channels/memes/wallets/submissions/activations).
- **Uploads**: локальное `uploads/`, дедупликация по SHA‑256 (`FileHash`).
- **Twitch**:
  - OAuth login
  - управление Channel Points reward
  - EventSub webhooks (HMAC, replay‑защита)

## Роутинг и модель доступа

### Группы роутов

- **Публичные/полупубличные**
  - `GET /health`
  - `GET /channels/:slug`
  - `GET /channels/:slug/memes`
  - `GET /channels/memes/search`
  - `GET /memes/stats`

- **Viewer (auth)**
  - `GET /me`
  - `GET /channels/:slug/wallet`
  - `POST /memes/:id/activate`

- **Streamer panel**: `/streamer/*` (роль `streamer` или `admin`)
- **Owner-only**: `/owner/*` (роль `admin`)

### Ключевые middleware

- `auth.ts`: JWT в httpOnly cookies → `req.userId`, `req.channelId`, `req.userRole`
- `betaAccess.ts`: gating beta домена (только пользователи с доступом)
- `csrf.ts`: защита state-changing операций
- `rateLimit.ts`: глобальные и точечные лимитеры
- `upload.ts`: multer + защита от spoofing и лимиты

## Организация контроллеров

Контроллеры сгруппированы по фичам, при этом сохраняются фасады для совместимости.

- **Streamer/Owner**
  - фасады: `src/controllers/adminController.ts`, `src/controllers/viewerController.ts`, `src/controllers/submissionController.ts`
  - модули: `src/controllers/admin/*`

- **Viewer**
  - модули: `src/controllers/viewer/*`
  - `cache.ts`: ETag + in‑memory TTL caches
  - `search.ts`: поиск с лимитами и кэшем, популярность через SQL (корректная пагинация)
  - `stats.ts`: топ‑мемы через `groupBy`, кэш по минутным “бакетам”
  - `activation.ts`: активация + списание + emit в overlay

- **Submissions**
  - `createSubmission.ts`: загрузка/валидация/дедуп, защита от подвисаний через timeouts
  - `importMeme.ts`: server-side download + валидация

## Ключевые потоки выполнения

### 1) Активация мема (viewer → overlay)

1. `POST /memes/:id/activate`
2. Снаружи транзакции: проверка статуса мема + расчёт цены (с учётом промо).
3. В транзакции: wallet upsert → проверка баланса → списание → `MemeActivation(status=queued)`.
4. Socket.IO emit в комнату `channel:{slugLower}`: `activation:new`.
5. Socket.IO emit в комнату `user:{userId}`: `wallet:updated` + best‑effort relay на соседний инстанс (prod↔beta).

### 2) Создание submission (upload → очередь модерации)

1. `POST /submissions` (multer + лимиты)
2. Проверка magic bytes (anti-spoofing), размера и длительности (ffprobe, fallback на фронтовый duration).
3. Дедупликация файла по SHA‑256, перенос в `/uploads/memes/{hash}.{ext}`.
4. Если uploader = владелец канала → создаём approved мем напрямую; иначе `MemeSubmission(status=pending)`.
5. Socket.IO событие `submission:created` (best‑effort, не ломает запрос при ошибке emit).

## Performance / UX заметки (актуальные)

- **Короткие транзакции**: транзакция в активации держит только wallet+activation; промо‑поиск вынесен наружу.
- **Кэш**: search/stats используют короткие TTL и ETag/304; промо имеет короткий TTL по `channelId`.
- **Event-loop**: синхронные `fs.*Sync` в горячих путях заменены на async-операции (меньше “фризов” под нагрузкой).
- **Индексы**: `MemeActivation` имеет композитные индексы под popularity/favorites (см. `prisma/schema.prisma`).

## Окружения и деплой

Детали CI/CD и стратегии веток/релизов вынесены в `DEPLOYMENT.md`.
