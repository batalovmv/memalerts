# MemAlerts Backend — боты (Twitch / YouTube / VKVideo)

Этот документ — “шпаргалка по ботам” для разработчиков: **как включать**, **как работает**, **как запускать воркеры**, **какие ENV нужны**, **как дебажить**.

## TL;DR (что нужно знать)

- **Управление из панели стримера (frontend)**:
  - `GET /streamer/bots` — текущие тумблеры интеграций (`twitch | youtube | vkvideo | vkplaylive`)
  - `PATCH /streamer/bots/:provider` — включить/выключить (и создать/обновить подписку в БД)
- **Сами боты — это отдельные процессы-воркеры** (кроме “inline credits bot”):
  - Twitch runner: `pnpm build && pnpm start:chatbot`
  - YouTube runner: `pnpm build && pnpm start:youtube-chatbot`
  - VKVideo runner: `pnpm build && pnpm start:vkvideo-chatbot`
- **Ключевой паттерн**: API пишет состояние в БД (подписки/команды/аутбокс), воркеры **периодически синкаются** с БД и исполняют.

## 1) Twitch bot

В проекте есть **два** Twitch‑сценария:

### 1.1 Twitch “global runner” (рекомендуемый, основной)

Файл: `src/bots/chatbotRunner.ts` (в dist: `dist/bots/chatbotRunner.js`).

Что делает:
- Подключается к Twitch IRC через `tmi.js` под логином `CHAT_BOT_LOGIN`.
- Берёт список включённых каналов из БД `ChatBotSubscription` (где `enabled=true`) и **join/part** в чаты.
- Отвечает на команды из БД `ChatBotCommand`:
  - **обычные команды**: триггер → ответ
  - **умная команда “время стрима”** (конфиг хранится на `Channel.streamDurationCommandJson`)
- Доставляет сообщения, которые API складывает в `ChatBotOutboxMessage` (например `/streamer/bot/say`) — с ретраями.
- Параллельно постит “credits chatter” события на `/internal/credits/chatter` (на все инстансы из `CHATBOT_BACKEND_BASE_URLS`).

Как включается на канале:
- В панели: `PATCH /streamer/bots/twitch` body `{ enabled: true }`
  - Требование: канал должен быть привязан к Twitch (`Channel.twitchChannelId != null`), иначе 400.
  - При включении/выключении API обновляет `ChatBotSubscription` (twitch login берётся через Helix).

ENV (минимум для запуска):
- `CHAT_BOT_LOGIN` — логин Twitch‑аккаунта бота (lowercase)
- `CHATBOT_BACKEND_BASE_URLS` — список baseUrl’ов инстансов для internal relay (через запятую), например `http://127.0.0.1:3001,http://127.0.0.1:3002`
- Должен существовать “bot user” в БД, чтобы достать access token:
  - один из: `CHAT_BOT_USER_ID` **или** `CHAT_BOT_TWITCH_USER_ID` (или fallback по `CHAT_BOT_LOGIN`, см. код)

Запуск:
- `pnpm build && pnpm start:chatbot`

Примечания:
- Воркер сам обновляет access token через `getValidAccessToken/refreshAccessToken` (берётся из БД по userId).
- Синк подписок/аутбокса/команд — по таймерам (`CHATBOT_SYNC_SECONDS`, `CHATBOT_OUTBOX_POLL_MS`, `CHATBOT_COMMANDS_REFRESH_SECONDS`).

### 1.2 Twitch “inline credits bot” (редкий/локальный режим)

Файл: `src/bots/twitchChatBot.ts`.

Что делает:
- Если `CHAT_BOT_ENABLED=1`, подключается к Twitch IRC и **собирает чаттеров** для credits overlay.
- Каналы берёт НЕ из БД, а из ENV mapping:
  - `CHAT_BOT_CHANNELS=login:slug,login2:slug2` (или `CHAT_BOT_CHANNEL_MAP_JSON=[...]`)
- Работает как часть основного API процесса (стартится из `src/index.ts`).

Когда использовать:
- для локальной отладки credits без развёрнутого воркера/БД подписок.

## 2) YouTube bot (runner)

Файл: `src/bots/youtubeChatbotRunner.ts`.

Что делает:
- Синхронизирует подписки из БД `YouTubeChatBotSubscription` (enabled=true).
- Для каждого канала:
  - проверяет, есть ли LIVE (по YouTube API, ищет live video + activeLiveChatId)
  - поллит live chat сообщения и:
    - шлёт credits chatter события в `/internal/credits/chatter`
    - отвечает на команды из `ChatBotCommand` (простые) и `Channel.streamDurationCommandJson` (умная)
- Доставляет outbox сообщения из `YouTubeChatBotOutboxMessage` (API складывает их через `/streamer/bot/say` с `provider=youtube`).

Как включается на канале:
- В панели: `PATCH /streamer/bots/youtube` body `{ enabled: true }`
  - Требование: у пользователя должен быть привязан YouTube аккаунт с нужными scopes (иначе 400 “Failed to resolve YouTube channelId…”).
  - API достаёт `youtubeChannelId` “моего канала” через `fetchMyYouTubeChannelId()` и пишет/апдейтит `YouTubeChatBotSubscription`.

ENV (минимум для запуска):
- `CHATBOT_BACKEND_BASE_URLS` — для internal relay
- OAuth креды YouTube/Google должны быть настроены на основном API инстансе (воркер берёт refresh/access token из БД):
  - `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, callback’и и т.п. (см. `ENV.example`)

Запуск:
- `pnpm build && pnpm start:youtube-chatbot`

Важно:
- YouTube может отправлять сообщения **только когда есть активный live chat**. Если стрим оффлайн — аутбокс будет ретраиться и затем помечаться `failed` (“No active live chat”).

## 3) VKVideo bot (runner)

Файлы:
- runner: `src/bots/vkvideoChatbotRunner.ts`
- pubsub клиент (Centrifugo v4): `src/bots/vkvideoPubsubClient.ts`

Что делает:
- Синхронизирует подписки из БД `VkVideoChatBotSubscription` (enabled=true).
- Получает JWT для pubsub (Centrifugo) через VKVideo Live DevAPI:
  - `GET /v1/websocket/token` — токен подключения
  - `GET /v1/websocket/subscription_token` — подписочные токены для limited-каналов (если нужны)
- Подключается к pubsub WebSocket (Centrifugo v4, протокол v2):
  - по умолчанию: `wss://pubsub-dev.live.vkvideo.ru/connection/websocket?format=json&cf_protocol_version=v2`
- Для каждого канала получает имена ws-каналов через `GET /v1/channel` (из `channel.web_socket_channels`), подписывается на `chat`/`limited_chat` и обрабатывает входящие сообщения.
- На входящие сообщения:
  - шлёт credits chatter события в `/internal/credits/chatter`
  - отвечает на `ChatBotCommand` и “время стрима” как и остальные (но **роли VKVideo пока не маппятся**, фактически работает whitelist по `allowedUsers`)
- Доставляет outbox сообщения из `VkVideoChatBotOutboxMessage`.
  - отправка сообщения в чат делается через VKVideo Live DevAPI: `POST /v1/chat/message/send`
  - требуются `channel_url` и `stream_id` (stream_id берётся из `GET /v1/channel` → `data.stream.id`)

Как включается на канале:
- В панели: `PATCH /streamer/bots/vkvideo`
  - включить: body `{ enabled: true, vkvideoChannelId?: string, vkvideoChannelUrl?: string }`
    - если `vkvideoChannelId` не передан, API попробует определить его автоматически через `GET /v1/current_user` (нужна линковка VKVideo аккаунта)
    - **важно**: для работы DevAPI требуется `vkvideoChannelUrl` (URL канала). API пытается определить его из `current_user`, иначе нужно передать явно.
  - выключить: body `{ enabled: false }`

### Автоподтягивание канала для фронтенда (рекомендуемый UX)

Чтобы пользователь нажимал только “Вкл/Выкл”, фронтенд может заранее получить список каналов из VKVideo `current_user`:

- `GET /streamer/bots/vkvideo/candidates`
  - возвращает `{ items: [{ url, vkvideoChannelId }] }`
  - если VKVideo не привязан: `400` с `code=VKVIDEO_NOT_LINKED`

Рекомендуемый флоу:
- после успешной линковки VKVideo (и/или при открытии настроек бота) вызвать `GET /streamer/bots/vkvideo/candidates`
- если `items.length === 1` → при включении бота отправлять `PATCH /streamer/bots/vkvideo` с `vkvideoChannelUrl=items[0].url`
- если `items.length > 1` → показать выбор канала (url) и затем включать с выбранным `vkvideoChannelUrl`
- если `items.length === 0` или `VKVIDEO_CURRENT_USER_FAILED` → показать поле ввода ссылки на канал и включать с введённым `vkvideoChannelUrl`

Важно:
- старые подписки (включённые до обновления) могут не иметь `vkvideoChannelUrl` в БД → нужно один раз сделать “выкл → вкл”, чтобы пересохранить подписку корректно.

ENV (минимум для запуска):
- `VKVIDEO_CHAT_BOT_ENABLED=1`
- `CHATBOT_BACKEND_BASE_URLS`
- Должен быть настроен VKVideo DevAPI baseUrl (нужен для `GET /v1/*`):
  - либо `VKVIDEO_API_BASE_URL`
  - либо legacy-настройка через `VKVIDEO_USERINFO_URL` (baseUrl будет выведен из неё)
- Опционально:
  - `VKVIDEO_PUBSUB_WS_URL` — переопределить pubsub websocket URL (по умолчанию используется dev pubsub)

Запуск:
- `pnpm build && pnpm start:vkvideo-chatbot`

Важно:
- VKVideo runner использует WebSocket (Centrifugo pubsub). На Node 20+ берётся встроенный `globalThis.WebSocket`, на Node 18 используется fallback через пакет `ws`.
- Отправка сообщений в чат идёт **от имени того VKVideo аккаунта, чьи OAuth токены используются** (см. ниже “про глобального бота”).

## 4) Команды и “say” (API → outbox)

### Команды (CRUD)

Команды создаются/редактируются в API и хранятся в `ChatBotCommand` (общая таблица для всех платформ):
- `GET /streamer/bot/commands`
- `POST /streamer/bot/commands`
- `PATCH /streamer/bot/commands/:id`
- `DELETE /streamer/bot/commands/:id`

Поля:
- `trigger`, `response`, `enabled`, `onlyWhenLive`
- `allowedRoles`, `allowedUsers`

Платформенные нюансы:
- Twitch: реально работает `allowedUsers` + роли `vip/moderator/subscriber` (follower пока не определяется из IRC tags).
- YouTube: роли не поддерживаются (в раннере используются только `trigger/response/onlyWhenLive`).
- VKVideo: роли пока не маппятся, фактически работает whitelist по `allowedUsers`.

### “Сказать сообщение в чат” (outbox)

`POST /streamer/bot/say` body:
- `{ message: string }` — по умолчанию отправит в Twitch (если включён **только Twitch**)
- `{ provider: "youtube", message: string }` — отправит в YouTube (если YouTube бот включён)
- `{ provider: "vkvideo", message: string }` — отправит в VKVideo (если VKVideo бот включён)

Важно:
- Если включено **несколько** ботов (например `twitch` и `vkvideo`), то `provider` **нужно** передать явно — иначе API вернёт 400 с `enabledProviders`.
- Для YouTube/VKVideo сообщение отправляется через outbox: если интеграция выключена — API вернёт 400.

## 5) Диагностика (быстрые чек‑листы)

### Бот “не отвечает” / “не заходит в чат”

- Twitch:
  - проверьте, что включено: `GET /streamer/bots` → `twitch.enabled=true`
  - проверьте подписку: `ChatBotSubscription.enabled=true` и `twitchLogin` корректный
  - проверьте ENV воркера: `CHAT_BOT_LOGIN`, `CHATBOT_BACKEND_BASE_URLS`, bot user id
  - проверьте, что воркер запущен (`pnpm start:chatbot`) и в логах есть `chatbot.connected` + `chatbot.join`
- YouTube:
  - включено: `GET /streamer/bots` → `youtube.enabled=true`
  - есть линковка YouTube у пользователя (иначе enable вернёт 400)
  - канал реально в LIVE (иначе команды/аутбокс не сработают)
- VKVideo:
  - включено: `GET /streamer/bots` → `vkvideo.enabled=true`
  - ENV: `VKVIDEO_CHAT_BOT_ENABLED=1`, `CHATBOT_BACKEND_BASE_URLS`, `VKVIDEO_API_BASE_URL`/`VKVIDEO_USERINFO_URL`
  - убедитесь, что в `VkVideoChatBotSubscription` заполнены:
    - `userId` (владелец, чьи токены используются)
    - `vkvideoChannelUrl` (URL канала)
  - проверьте логи воркера на `websocket_token_failed`, `subscription_missing_channel_url`, `channel_info_failed`, `outbox_send_failed`.

### “/streamer/bots возвращает 404 Feature not available”

Это означает, что на этом инстансе ещё не применены миграции (Prisma `P2021` — нет таблицы). Фронт должен показать “фича недоступна”.


