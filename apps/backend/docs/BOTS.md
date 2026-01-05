# MemAlerts Backend — боты и чат‑интеграции (Twitch / YouTube / VKVideo / Trovo / Kick)

Этот документ — “шпаргалка по ботам” для разработчиков: **как включать**, **как работает**, **как запускать воркеры**, **какие ENV нужны**, **как дебажить**.

## TL;DR (главное)

- **Есть два слоя:**
  - **интеграции/подписки** (какие каналы слушаем, где брать сообщения) — включаются стримером через `PATCH /streamer/bots/:provider`, сохраняются в БД;
  - **sender identity** (от чьего имени бот пишет в чат) — либо **global default bot** (настраивает owner/admin), либо **per‑channel custom bot** (override для канала, требует entitlement `custom_bot`).
- **Воркеры — отдельные процессы** (кроме legacy “inline credits bot” в API):
  - Twitch runner: `pnpm build && pnpm start:chatbot`
  - YouTube runner: `pnpm build && pnpm start:youtube-chatbot`
  - VKVideo runner: `pnpm build && pnpm start:vkvideo-chatbot`
  - Trovo runner: `pnpm build && pnpm start:trovo-chatbot`
  - Kick runner: `pnpm build && pnpm start:kick-chatbot`
- **Ключевой паттерн**: API пишет состояние в БД (togg’лы/подписки/команды/outbox), воркеры **периодически синкаются** с БД и исполняют.
- **Multi‑instance (prod+beta на одном VPS)**: воркеры шлют “credits chatter” события через internal relay на все инстансы из `CHATBOT_BACKEND_BASE_URLS`.

## 1) API: управление из панели стримера

### 1.1 Тумблеры интеграций (provider gates + подписки)

- `GET /streamer/bots` → список `{ provider, enabled, updatedAt }` для: `twitch | vkvideo | youtube | trovo | kick`
- `PATCH /streamer/bots/:provider` body `{ enabled: boolean, ...providerSpecific }`
  - **twitch**: требует `Channel.twitchChannelId` (канал привязан к Twitch)
  - **youtube**: требует привязанный YouTube у пользователя и успешное определение `youtubeChannelId` (возможен `412 YOUTUBE_RELINK_REQUIRED`)
  - **vkvideo**: требует `vkvideoChannelUrl` (может быть автодетект через VKVideo `current_user`, но при нескольких каналах нужно передать явно)
  - **trovo**: нужен `trovoChannelId` (можно передать явно или дать API попытаться определить по привязке)
  - **kick**: нужен `kickChannelId` (можно передать явно или дать API попытаться определить по привязке); при включении API также убеждается, что есть Kick Events subscription на `chat.message.sent`
- `GET /streamer/bots/vkvideo/candidates` → `{ items: [{ url, vkvideoChannelId }] }` (помогает фронту автозаполнить URL для VKVideo)

### 1.2 Custom bot sender (per‑channel override, требует entitlement `custom_bot`)

Эти эндпоинты настраивают **каким аккаунтом** бот будет **писать** в чат для конкретного канала (override).

- `GET /streamer/bots/:provider/bot` → статус override (и `lockedBySubscription`)
- `GET /streamer/bots/:provider/bot/link` → старт OAuth линковки bot‑аккаунта для этого канала
- `DELETE /streamer/bots/:provider/bot` → убрать override (вернуться к глобальному default bot)

Провайдеры: `twitch | youtube | vkvideo | trovo | kick`.

Важно:
- Линковка bot‑аккаунтов **не должна** “отлинковываться” через `DELETE /auth/accounts/:externalAccountId` — это заблокировано, API вернёт 409 с подсказкой нужного endpoint.

### 1.3 Команды и “say” (API → outbox)

#### Команды (CRUD)

Команды хранятся в `ChatBotCommand` и используются разными воркерами.

- `GET /streamer/bot/commands`
- `POST /streamer/bot/commands`
- `PATCH /streamer/bot/commands/:id`
- `DELETE /streamer/bot/commands/:id`

Поля (то, что реально поддерживает API сейчас):
- `trigger`, `response`, `enabled`, `onlyWhenLive`
- `allowedUsers` — список twitch‑логинов (lowercase, можно с `@`)
- `allowedRoles` — роли Twitch: `vip | moderator | subscriber | follower` (но `follower` пока **не резолвится** из IRC tags)
- `vkvideoAllowedRoleIds` — VKVideo role ids (используются VKVideo раннером)

Платформенные нюансы:
- Twitch: **работает** `allowedUsers` и роли `vip/moderator/subscriber` (см. ограничение про `follower`).
- VKVideo: **работает** `allowedUsers` и `vkvideoAllowedRoleIds` (через VKVideo roles API, либо через `VKVIDEO_ROLE_STUBS_JSON`).
- Trovo/Kick: сейчас **по сути работает только** `allowedUsers` (allowedRoles сохраняются, но не являются полноценной платформенной моделью ролей).
- YouTube: на текущий момент role‑gating через этот API не является стабильным контрактом; ориентируйтесь на `trigger/response/onlyWhenLive`.

#### “Сказать сообщение в чат” (outbox)

`POST /streamer/bot/say` body:
- `{ message: string }` — по умолчанию отправит в единственный включённый чат‑провайдер (или Twitch для back‑compat)
- `{ provider: "twitch"|"youtube"|"vkvideo"|"trovo"|"kick", message: string }`

Важно:
- Если включено **несколько** ботов, `provider` **нужно** передать явно — иначе API вернёт 400 с `enabledProviders`.
- Статус доставки можно проверить: `GET /streamer/bot/outbox/:provider/:id`.

### 1.4 Bot settings (смежные фичи)

- **Follow greetings (Twitch EventSub)**:
  - `GET /streamer/bot/follow-greetings`
  - `POST /streamer/bot/follow-greetings/enable|disable`
  - `PATCH /streamer/bot/follow-greetings`
- **Smart command: “время стрима”** (общая конфигурация на `Channel.streamDurationCommandJson`):
  - `GET /streamer/bot/stream-duration`
  - `PATCH /streamer/bot/stream-duration`

### 1.5 Legacy endpoints (остались для совместимости)

- `POST /streamer/bot/enable|disable` — старый Twitch‑тумблер через `ChatBotSubscription`.
  - В новых интеграциях предпочитайте `PATCH /streamer/bots/twitch`.

## 2) Owner/Admin: global default bot (общий sender для всех каналов)

Это настройка “глобального” bot‑аккаунта, от имени которого воркеры **пишут** в чат, если нет per‑channel override.

Эндпоинты (admin‑only):
- `GET /owner/bots/{provider}/default/status`
- `GET /owner/bots/{provider}/default/link`
- `DELETE /owner/bots/{provider}/default`

`provider`: `twitch | youtube | vkvideo | trovo | kick`.

Примечание: у YouTube также остаётся back‑compat fallback через ENV `YOUTUBE_BOT_REFRESH_TOKEN` (если DB‑credential не настроен).

## 3) Воркеры (runner’ы) и их ENV

Общее для всех воркеров:
- `DATABASE_URL` (через Prisma)
- `CHATBOT_BACKEND_BASE_URLS` — список baseUrl’ов инстансов для internal relay, например `http://127.0.0.1:3001,http://127.0.0.1:3002`
  - воркеры постят credits chatter в `POST /internal/credits/chatter` с заголовком `x-memalerts-internal: credits-event`

### 3.1 Twitch runner (global)

- **Файл**: `src/bots/chatbotRunner.ts` (dist: `dist/bots/chatbotRunner.js`)
- **Запуск**: `pnpm build && pnpm start:chatbot`
- **Что делает**:
  - подключается к Twitch IRC (`tmi.js`)
  - join/part по `ChatBotSubscription(enabled=true)` (+ optional gate `BotIntegrationSettings(provider=twitch)`)
  - отвечает на `ChatBotCommand` + smart “время стрима”
  - доставляет `ChatBotOutboxMessage` (API складывает через `/streamer/bot/say`)
  - шлёт credits chatter в internal relay
  - поддерживает per‑channel sender override: `TwitchBotIntegration` (если канал entitled `custom_bot`)
- **ENV (минимум)**:
  - `CHATBOT_BACKEND_BASE_URLS`
  - `CHAT_BOT_LOGIN`
  - для legacy fallback токена (если global default bot не настроен в БД):
    - `CHAT_BOT_USER_ID` **или** `CHAT_BOT_TWITCH_USER_ID` (или поиск по `CHAT_BOT_LOGIN` в БД)
- **Таймеры**:
  - `CHATBOT_SYNC_SECONDS`, `CHATBOT_OUTBOX_POLL_MS`, `CHATBOT_COMMANDS_REFRESH_SECONDS`

### 3.2 YouTube runner

- **Файл**: `src/bots/youtubeChatbotRunner.ts`
- **Запуск**: `pnpm build && pnpm start:youtube-chatbot`
- **Что делает**:
  - синкает `YouTubeChatBotSubscription(enabled=true)` (+ optional gate `BotIntegrationSettings(provider=youtube)`)
  - проверяет LIVE (live video + activeLiveChatId), поллит live chat messages
  - шлёт credits chatter
  - отвечает на команды + smart “время стрима”
  - доставляет `YouTubeChatBotOutboxMessage`
  - пишет в чат либо глобальным ботом, либо per‑channel override (YouTubeBotIntegration, только если `custom_bot`)
- **ENV (минимум)**:
  - `CHATBOT_BACKEND_BASE_URLS`
  - YouTube OAuth для линковок/токенов в БД: `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, `YOUTUBE_CALLBACK_URL`
  - отправка сообщений: рекомендуется настроить global default bot через `/owner/bots/youtube/default/link`
    - fallback: `YOUTUBE_BOT_REFRESH_TOKEN` (legacy)
- **Важно**:
  - YouTube может отправлять сообщения **только когда есть активный live chat**. Если стрим оффлайн — outbox ретраится и затем станет `failed` (“No active live chat”).

### 3.3 VKVideo runner

- **Файлы**: `src/bots/vkvideoChatbotRunner.ts`, `src/bots/vkvideoPubsubClient.ts`
- **Запуск**: `pnpm build && pnpm start:vkvideo-chatbot`
- **Что делает**:
  - синкает `VkVideoChatBotSubscription(enabled=true)` (+ optional gate `BotIntegrationSettings(provider=vkvideo)`)
  - подключается к VKVideo pubsub (Centrifugo v4 / protocol v2), слушает chat/limited_chat/info/channel_points
  - шлёт credits chatter
  - отвечает на команды + smart “время стрима”
  - доставляет `VkVideoChatBotOutboxMessage`
  - использует `vkvideoAllowedRoleIds` (реальные роли через VKVideo roles API или заглушки)
- **ENV (минимум)**:
  - `VKVIDEO_CHAT_BOT_ENABLED=1`
  - `CHATBOT_BACKEND_BASE_URLS`
  - VKVideo DevAPI baseUrl (используется в `utils/vkvideoApi.ts`): `VKVIDEO_API_BASE_URL` (или legacy `VKVIDEO_USERINFO_URL`)
- **Опционально**:
  - `VKVIDEO_PUBSUB_WS_URL` (по умолчанию dev pubsub)
  - `VKVIDEO_PUBSUB_REFRESH_SECONDS` (рекомендуется 600+)
  - `VKVIDEO_ROLE_STUBS_JSON` (заглушки ролей, см. ниже)
  - `VKVIDEO_USER_ROLES_CACHE_TTL_MS`

#### VKVIDEO_ROLE_STUBS_JSON (заглушки ролей)

Используется для role‑gating команд по `ChatBotCommand.vkvideoAllowedRoleIds`, если реальные роли недоступны/нестабильны.

Формат:
- верхний ключ: `<vkvideoChannelId>`
- внутри: mapping “кто” → список строк‑roleId (произвольные)
  - `login:<senderLogin>` — lowercase
  - `user:<vkvideoUserId>` — VKVideo user id

Пример:

```json
{
  "lotasbro": {
    "login:lotas": ["role:moderator", "role:vip"],
    "login:friend1": ["role:vip"],
    "user:123456": ["role:moderator"]
  }
}
```

### 3.4 Trovo runner

- **Файл**: `src/bots/trovoChatbotRunner.ts`
- **Запуск**: `pnpm build && pnpm start:trovo-chatbot`
- **Что делает**:
  - синкает `TrovoChatBotSubscription(enabled=true)` (+ optional gate `BotIntegrationSettings(provider=trovo)`)
  - читает чат через WebSocket (использует токен стримера), отвечает/шлёт outbox через global/per‑channel bot token
  - шлёт credits chatter
- **ENV (минимум)**:
  - `CHATBOT_BACKEND_BASE_URLS`
  - `TROVO_CLIENT_ID` (и обычно `TROVO_CLIENT_SECRET`, `TROVO_CALLBACK_URL` для линковок)
  - `TROVO_CHAT_BOT_ENABLED` (если `0|false|off` — воркер выйдет)
- **Опционально**:
  - `TROVO_CHAT_WS_URL`, `TROVO_CHAT_TOKEN_URL`, `TROVO_SEND_CHAT_URL`
  - `TROVO_CHATBOT_SYNC_SECONDS`, `TROVO_CHATBOT_OUTBOX_POLL_MS`, `TROVO_CHATBOT_COMMANDS_REFRESH_SECONDS`

### 3.5 Kick runner

- **Файл**: `src/bots/kickChatbotRunner.ts`
- **Запуск**: `pnpm build && pnpm start:kick-chatbot`
- **Что делает**:
  - синкает `KickChatBotSubscription(enabled=true)` (+ optional gate `BotIntegrationSettings(provider=kick)`)
  - обеспечивает наличие Kick event subscriptions (на стороне Kick) на вебхук `POST /webhooks/kick/events`
  - отправляет сообщения в чат (global/per‑channel bot token), обрабатывает outbox
  - шлёт credits chatter
  - (опционально) может поллить чат по `KICK_CHAT_POLL_URL_TEMPLATE` как fallback/дополнение
- **ENV (минимум)**:
  - `CHATBOT_BACKEND_BASE_URLS`
  - `KICK_SEND_CHAT_URL`
  - `KICK_CHAT_BOT_ENABLED` (если `0|false|off` — воркер выйдет)
  - для корректного callback URL: `DOMAIN` (или явный `KICK_WEBHOOK_CALLBACK_URL`)
- **Опционально**:
  - `KICK_CHAT_POLL_URL_TEMPLATE` (шаблон URL для поллинга, переменные `{channelId}`, `{cursor}`)
  - `KICK_CHATBOT_SYNC_SECONDS`, `KICK_CHATBOT_OUTBOX_POLL_MS`, `KICK_CHATBOT_COMMANDS_REFRESH_SECONDS`, `KICK_CHATBOT_INGEST_POLL_MS`

## 4) Диагностика (быстрые чек‑листы)

### “/streamer/bots возвращает 404 Feature not available”

На этом инстансе ещё не применены миграции/таблицы (Prisma `P2021`). Фронт должен показать “фича недоступна”.

### Бот “не отвечает” / “не пишет в чат”

- **Проверить включение**: `GET /streamer/bots` → нужный `provider.enabled=true`
- **Проверить sender identity**:
  - глобальный бот: `GET /owner/bots/{provider}/default/status`
  - per‑channel override: `GET /streamer/bots/{provider}/bot` (и entitlement `custom_bot`)
- **Проверить воркер**: он запущен и видит `CHATBOT_BACKEND_BASE_URLS`
- **Проверить outbox**:
  - отправить `/streamer/bot/say`, затем `GET /streamer/bot/outbox/:provider/:id`
- **YouTube специфично**: канал должен быть в LIVE, иначе отправка/ответы могут быть невозможны (outbox → “No active live chat”).
- **VKVideo специфично**: в подписке должен быть `vkvideoChannelUrl`, и в логах не должно быть `subscription_missing_channel_url` / `websocket_token_failed`.
