# MemAlerts Backend — bots and chat integrations (Twitch / YouTube / VKVideo)

This document is a developer cheat-sheet for bots: **how to enable**, **how it works**, **how to run workers**, **which ENV vars are required**, and **how to debug**.

## TL;DR (the essentials)

- **There are two layers:**
  - **integrations/subscriptions** (which channels we listen to, where messages come from) — enabled by the streamer via `PATCH /streamer/bots/:provider`, persisted in the DB;
  - **sender identity** (which account the bot uses to *send* messages) — either a **global default bot** (configured by owner/admin) or a **per-channel custom bot** (channel override; requires the `custom_bot` entitlement).
- **Workers are separate processes**:
  - Twitch runner: `pnpm build && pnpm start:chatbot`
  - YouTube runner: `pnpm build && pnpm start:youtube-chatbot`
  - VKVideo runner: `pnpm build && pnpm start:vkvideo-chatbot`
- **Core pattern**: the API writes state to the DB (toggles/subscriptions/outbox); workers **periodically sync** from the DB and execute.
- **Multi-instance (prod + beta on the same VPS)**: set `CHATBOT_BACKEND_BASE_URLS` to all API base URLs (e.g. `http://127.0.0.1:3001,http://127.0.0.1:3002`).

## 1) API: streamer dashboard controls

### 1.1 Integration toggles (provider gates + subscriptions)

- `GET /streamer/bots` → returns `{ provider, enabled, updatedAt }` for: `twitch | vkvideo | youtube`
- `PATCH /streamer/bots/:provider` body `{ enabled: boolean, ...providerSpecific }`
  - **twitch**: requires `Channel.twitchChannelId` (channel is linked to Twitch)
  - **youtube**: requires the user’s YouTube account to be linked and successful resolution of `youtubeChannelId` (may return `412 YOUTUBE_RELINK_REQUIRED`)
  - **vkvideo**: requires `vkvideoChannelUrl` (can be auto-detected via VKVideo `current_user`, but when multiple channels exist it must be passed explicitly)
- `GET /streamer/bots/vkvideo/candidates` → `{ items: [{ url, vkvideoChannelId }] }` (helps the frontend auto-fill VKVideo URL)

### 1.2 Custom bot sender (per-channel override; requires entitlement `custom_bot`)

These endpoints configure **which account** the bot uses to **send** chat messages for a specific channel (override).

- `GET /streamer/bots/:provider/bot` → override status (and `lockedBySubscription`)
- `GET /streamer/bots/:provider/bot/link` → start OAuth linking for a bot account for this channel
- `DELETE /streamer/bots/:provider/bot` → remove override (go back to the global default bot)

Providers: `twitch | youtube | vkvideo`.

Important:
- Linking bot accounts **must not** be “unlinked” via `DELETE /auth/accounts/:externalAccountId` — this is blocked; the API returns 409 with guidance to use the correct endpoint.

### 1.3 “Say a message in chat” (API → outbox)

`POST /streamer/bot/say` body:
- `{ message: string }` — by default sends to the only enabled chat provider (or Twitch for backwards compatibility)
- `{ provider: "twitch"|"youtube"|"vkvideo", message: string }`

Important:
- If **multiple** bots are enabled, you **must** pass `provider` explicitly — otherwise the API returns 400 with `enabledProviders`.
- You can check delivery status via `GET /streamer/bot/outbox/:provider/:id`.

### 1.4 Legacy endpoints (kept for compatibility)

- `POST /streamer/bot/enable|disable` — legacy Twitch toggle via `ChatBotSubscription`.
  - For new integrations, prefer `PATCH /streamer/bots/twitch`.

## 2) Owner/Admin: global default bot (shared sender for all channels)

This configures the “global” bot account that workers use to **send** chat messages when there is no per-channel override.

Endpoints (admin-only):
- `GET /owner/bots/{provider}/default/status`
- `GET /owner/bots/{provider}/default/link`
- `DELETE /owner/bots/{provider}/default`

`provider`: `twitch | youtube | vkvideo`.

Note: for YouTube there is still a backwards-compat fallback via ENV `YOUTUBE_BOT_REFRESH_TOKEN` (if the DB credential is not configured).

## 3) Workers (runners) and their ENV

Common for all workers:
- `DATABASE_URL` (via Prisma)
- `CHATBOT_BACKEND_BASE_URLS` — list of instance base URLs for sync/outbox API calls

### 3.1 Twitch runner (global)

- **File**: `src/bots/chatbotRunner.ts` (dist: `dist/bots/chatbotRunner.js`)
- **Run**: `pnpm build && pnpm start:chatbot`
- **What it does**:
  - connects to Twitch IRC (`tmi.js`)
  - join/part based on `ChatBotSubscription(enabled=true)` (+ optional gate `BotIntegrationSettings(provider=twitch)`)
  - delivers `ChatBotOutboxMessage` (the API enqueues via `/streamer/bot/say`)
  - supports per-channel sender override via `TwitchBotIntegration` (only if the channel is entitled `custom_bot`)
- **ENV (minimum)**:
  - `CHATBOT_BACKEND_BASE_URLS`
  - `CHAT_BOT_LOGIN`
  - legacy fallback for sender token (if global default bot is not configured in DB):
    - `CHAT_BOT_USER_ID` **or** `CHAT_BOT_TWITCH_USER_ID` (or lookup by `CHAT_BOT_LOGIN` in DB)
- **Timers**:
  - `CHATBOT_SYNC_SECONDS`, `CHATBOT_OUTBOX_POLL_MS`

### 3.2 YouTube runner

- **File**: `src/bots/youtubeChatbotRunner.ts`
- **Run**: `pnpm build && pnpm start:youtube-chatbot`
- **What it does**:
  - syncs `YouTubeChatBotSubscription(enabled=true)` (+ optional gate `BotIntegrationSettings(provider=youtube)`)
  - checks LIVE (live video + `activeLiveChatId`) and polls live chat messages
  - delivers `YouTubeChatBotOutboxMessage`
  - sends chat messages either via global default bot, or per-channel override (`YouTubeBotIntegration`, only if `custom_bot`)
- **ENV (minimum)**:
  - `CHATBOT_BACKEND_BASE_URLS`
  - YouTube OAuth for linking / DB tokens: `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, `YOUTUBE_CALLBACK_URL`
  - sending messages: recommended to configure the global default bot via `/owner/bots/youtube/default/link`
    - fallback: `YOUTUBE_BOT_REFRESH_TOKEN` (legacy)
- **Important**:
  - YouTube can send messages **only when there is an active live chat**. If the stream is offline, the outbox will retry and eventually become `failed` (“No active live chat”).

### 3.3 VKVideo runner

- **Files**: `src/bots/vkvideoChatbotRunner.ts`, `src/bots/vkvideoPubsubClient.ts`
- **Run**: `pnpm build && pnpm start:vkvideo-chatbot`
- **What it does**:
  - syncs `VkVideoChatBotSubscription(enabled=true)` (+ optional gate `BotIntegrationSettings(provider=vkvideo)`)
  - connects to VKVideo pubsub (Centrifugo v4 / protocol v2), listens to `chat/limited_chat/info/channel_points`
  - delivers `VkVideoChatBotOutboxMessage`
- **ENV (minimum)**:
  - `VKVIDEO_CHAT_BOT_ENABLED=1`
  - `CHATBOT_BACKEND_BASE_URLS`
  - VKVideo DevAPI baseUrl (used in `utils/vkvideoApi.ts`): `VKVIDEO_API_BASE_URL` (or legacy `VKVIDEO_USERINFO_URL`)
- **Optional**:
  - `VKVIDEO_PUBSUB_WS_URL` (defaults to dev pubsub)
  - `VKVIDEO_PUBSUB_REFRESH_SECONDS` (recommended 600+)
  - `VKVIDEO_CHATBOT_SYNC_SECONDS`
  - `VKVIDEO_CHATBOT_OUTBOX_POLL_MS`

## 4) Diagnostics (quick checklists)

### “/streamer/bots returns 404 Feature not available”

Migrations/tables are not applied on this instance yet (Prisma `P2021`). The frontend should show “feature not available”.

### Bot “doesn’t respond” / “doesn’t send chat messages”

- **Check enabled**: `GET /streamer/bots` → ensure `provider.enabled=true`
- **Check sender identity**:
  - global bot: `GET /owner/bots/{provider}/default/status`
  - per-channel override: `GET /streamer/bots/{provider}/bot` (and entitlement `custom_bot`)
- **Check the worker**: it’s running and sees `CHATBOT_BACKEND_BASE_URLS`
- **Check outbox**:
  - send `/streamer/bot/say`, then `GET /streamer/bot/outbox/:provider/:id`
- **YouTube specific**: the channel must be LIVE, otherwise sending/replies may be impossible (outbox → “No active live chat”).
- **VKVideo specific**: the subscription must have `vkvideoChannelUrl`, and logs should not contain `subscription_missing_channel_url` / `websocket_token_failed`.
