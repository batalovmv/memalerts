# MemAlerts Backend — bots and chat integrations (Twitch / YouTube / VKVideo / Trovo / Kick)

This document is a developer cheat-sheet for bots: **how to enable**, **how it works**, **how to run workers**, **which ENV vars are required**, and **how to debug**.

## TL;DR (the essentials)

- **There are two layers:**
  - **integrations/subscriptions** (which channels we listen to, where messages come from) — enabled by the streamer via `PATCH /streamer/bots/:provider`, persisted in the DB;
  - **sender identity** (which account the bot uses to *send* messages) — either a **global default bot** (configured by owner/admin) or a **per-channel custom bot** (channel override; requires the `custom_bot` entitlement).
- **Workers are separate processes** (except the legacy “inline credits bot” inside the API):
  - Twitch runner: `pnpm build && pnpm start:chatbot`
  - YouTube runner: `pnpm build && pnpm start:youtube-chatbot`
  - VKVideo runner: `pnpm build && pnpm start:vkvideo-chatbot`
  - Trovo runner: `pnpm build && pnpm start:trovo-chatbot`
  - Kick runner: `pnpm build && pnpm start:kick-chatbot`
- **Core pattern**: the API writes state to the DB (toggles/subscriptions/commands/outbox); workers **periodically sync** from the DB and execute.
- **Multi-instance (prod + beta on the same VPS)**: workers send “credits chatter” events via internal relay to all instances listed in `CHATBOT_BACKEND_BASE_URLS`.

## 1) API: streamer dashboard controls

### 1.1 Integration toggles (provider gates + subscriptions)

- `GET /streamer/bots` → returns `{ provider, enabled, updatedAt }` for: `twitch | vkvideo | youtube | trovo | kick`
- `PATCH /streamer/bots/:provider` body `{ enabled: boolean, ...providerSpecific }`
  - **twitch**: requires `Channel.twitchChannelId` (channel is linked to Twitch)
  - **youtube**: requires the user’s YouTube account to be linked and successful resolution of `youtubeChannelId` (may return `412 YOUTUBE_RELINK_REQUIRED`)
  - **vkvideo**: requires `vkvideoChannelUrl` (can be auto-detected via VKVideo `current_user`, but when multiple channels exist it must be passed explicitly)
  - **trovo**: needs `trovoChannelId` (can be passed explicitly or the API can try to infer it from the linked account)
  - **kick**: needs `kickChannelId` (can be passed explicitly or inferred); when enabling, the API also ensures there is a Kick Events subscription for `chat.message.sent`
- `GET /streamer/bots/vkvideo/candidates` → `{ items: [{ url, vkvideoChannelId }] }` (helps the frontend auto-fill VKVideo URL)

### 1.2 Custom bot sender (per-channel override; requires entitlement `custom_bot`)

These endpoints configure **which account** the bot uses to **send** chat messages for a specific channel (override).

- `GET /streamer/bots/:provider/bot` → override status (and `lockedBySubscription`)
- `GET /streamer/bots/:provider/bot/link` → start OAuth linking for a bot account for this channel
- `DELETE /streamer/bots/:provider/bot` → remove override (go back to the global default bot)

Providers: `twitch | youtube | vkvideo | trovo | kick`.

Important:
- Linking bot accounts **must not** be “unlinked” via `DELETE /auth/accounts/:externalAccountId` — this is blocked; the API returns 409 with guidance to use the correct endpoint.

### 1.3 Commands and “say” (API → outbox)

#### Commands (CRUD)

Commands are stored in `ChatBotCommand` and are used by multiple workers.

- `GET /streamer/bot/commands`
- `POST /streamer/bot/commands`
- `PATCH /streamer/bot/commands/:id`
- `DELETE /streamer/bot/commands/:id`

Fields (what the API actually supports right now):
- `trigger`, `response`, `enabled`, `onlyWhenLive`
- `allowedUsers` — list of Twitch logins (lowercase; may include `@`)
- `allowedRoles` — Twitch roles: `vip | moderator | subscriber | follower` (but `follower` is **not resolved** from IRC tags yet)
- `vkvideoAllowedRoleIds` — VKVideo role ids (used by the VKVideo runner)

Platform nuances:
- Twitch: `allowedUsers` and roles `vip/moderator/subscriber` **work** (see limitation about `follower`).
- VKVideo: `allowedUsers` and `vkvideoAllowedRoleIds` **work** (via VKVideo roles API, or via `VKVIDEO_ROLE_STUBS_JSON`).
- Trovo/Kick: currently **only** `allowedUsers` is effectively enforced (`allowedRoles` are stored but are not a complete platform role model).
- YouTube: role-gating via this API is not a stable contract yet; rely on `trigger/response/onlyWhenLive`.

#### “Say a message in chat” (outbox)

`POST /streamer/bot/say` body:
- `{ message: string }` — by default sends to the only enabled chat provider (or Twitch for backwards compatibility)
- `{ provider: "twitch"|"youtube"|"vkvideo"|"trovo"|"kick", message: string }`

Important:
- If **multiple** bots are enabled, you **must** pass `provider` explicitly — otherwise the API returns 400 with `enabledProviders`.
- You can check delivery status via `GET /streamer/bot/outbox/:provider/:id`.

### 1.4 Bot settings (adjacent features)

- **Follow greetings (Twitch EventSub)**:
  - `GET /streamer/bot/follow-greetings`
  - `POST /streamer/bot/follow-greetings/enable|disable`
  - `PATCH /streamer/bot/follow-greetings`
- **Smart command: “stream duration”** (shared config stored in `Channel.streamDurationCommandJson`):
  - `GET /streamer/bot/stream-duration`
  - `PATCH /streamer/bot/stream-duration`

### 1.5 Legacy endpoints (kept for compatibility)

- `POST /streamer/bot/enable|disable` — legacy Twitch toggle via `ChatBotSubscription`.
  - For new integrations, prefer `PATCH /streamer/bots/twitch`.

## 2) Owner/Admin: global default bot (shared sender for all channels)

This configures the “global” bot account that workers use to **send** chat messages when there is no per-channel override.

Endpoints (admin-only):
- `GET /owner/bots/{provider}/default/status`
- `GET /owner/bots/{provider}/default/link`
- `DELETE /owner/bots/{provider}/default`

`provider`: `twitch | youtube | vkvideo | trovo | kick`.

Note: for YouTube there is still a backwards-compat fallback via ENV `YOUTUBE_BOT_REFRESH_TOKEN` (if the DB credential is not configured).

## 3) Workers (runners) and their ENV

Common for all workers:
- `DATABASE_URL` (via Prisma)
- `CHATBOT_BACKEND_BASE_URLS` — list of instance base URLs for internal relay, e.g. `http://127.0.0.1:3001,http://127.0.0.1:3002`
  - workers post credits chatter to `POST /internal/credits/chatter` with header `x-memalerts-internal: credits-event`

### 3.1 Twitch runner (global)

- **File**: `src/bots/chatbotRunner.ts` (dist: `dist/bots/chatbotRunner.js`)
- **Run**: `pnpm build && pnpm start:chatbot`
- **What it does**:
  - connects to Twitch IRC (`tmi.js`)
  - join/part based on `ChatBotSubscription(enabled=true)` (+ optional gate `BotIntegrationSettings(provider=twitch)`)
  - responds to `ChatBotCommand` + the smart “stream duration” command
  - delivers `ChatBotOutboxMessage` (the API enqueues via `/streamer/bot/say`)
  - sends credits chatter via internal relay
  - supports per-channel sender override via `TwitchBotIntegration` (only if the channel is entitled `custom_bot`)
- **ENV (minimum)**:
  - `CHATBOT_BACKEND_BASE_URLS`
  - `CHAT_BOT_LOGIN`
  - legacy fallback for sender token (if global default bot is not configured in DB):
    - `CHAT_BOT_USER_ID` **or** `CHAT_BOT_TWITCH_USER_ID` (or lookup by `CHAT_BOT_LOGIN` in DB)
- **Timers**:
  - `CHATBOT_SYNC_SECONDS`, `CHATBOT_OUTBOX_POLL_MS`, `CHATBOT_COMMANDS_REFRESH_SECONDS`

### 3.2 YouTube runner

- **File**: `src/bots/youtubeChatbotRunner.ts`
- **Run**: `pnpm build && pnpm start:youtube-chatbot`
- **What it does**:
  - syncs `YouTubeChatBotSubscription(enabled=true)` (+ optional gate `BotIntegrationSettings(provider=youtube)`)
  - checks LIVE (live video + `activeLiveChatId`) and polls live chat messages
  - sends credits chatter
  - responds to commands + the smart “stream duration” command
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
  - sends credits chatter
  - responds to commands + the smart “stream duration” command
  - delivers `VkVideoChatBotOutboxMessage`
  - enforces `vkvideoAllowedRoleIds` (real roles via VKVideo roles API or stubs)
- **ENV (minimum)**:
  - `VKVIDEO_CHAT_BOT_ENABLED=1`
  - `CHATBOT_BACKEND_BASE_URLS`
  - VKVideo DevAPI baseUrl (used in `utils/vkvideoApi.ts`): `VKVIDEO_API_BASE_URL` (or legacy `VKVIDEO_USERINFO_URL`)
- **Optional**:
  - `VKVIDEO_PUBSUB_WS_URL` (defaults to dev pubsub)
  - `VKVIDEO_PUBSUB_REFRESH_SECONDS` (recommended 600+)
  - `VKVIDEO_ROLE_STUBS_JSON` (role stubs, see below)
  - `VKVIDEO_USER_ROLES_CACHE_TTL_MS`

#### VKVIDEO_ROLE_STUBS_JSON (role stubs)

Used for command role-gating via `ChatBotCommand.vkvideoAllowedRoleIds` if real roles are unavailable/unstable.

Format:
- top-level key: `<vkvideoChannelId>`
- inside: mapping “who” → list of string roleIds (arbitrary)
  - `login:<senderLogin>` — lowercase
  - `user:<vkvideoUserId>` — VKVideo user id

Example:

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

- **File**: `src/bots/trovoChatbotRunner.ts`
- **Run**: `pnpm build && pnpm start:trovo-chatbot`
- **What it does**:
  - syncs `TrovoChatBotSubscription(enabled=true)` (+ optional gate `BotIntegrationSettings(provider=trovo)`)
  - reads chat via WebSocket (uses the streamer token), replies/sends outbox via global/per-channel bot token
  - sends credits chatter
- **ENV (minimum)**:
  - `CHATBOT_BACKEND_BASE_URLS`
  - `TROVO_CLIENT_ID` (and usually `TROVO_CLIENT_SECRET`, `TROVO_CALLBACK_URL` for linking)
  - `TROVO_CHAT_BOT_ENABLED` (if `0|false|off` — the worker exits)
- **Optional**:
  - `TROVO_CHAT_WS_URL`, `TROVO_CHAT_TOKEN_URL`, `TROVO_SEND_CHAT_URL`
  - `TROVO_CHATBOT_SYNC_SECONDS`, `TROVO_CHATBOT_OUTBOX_POLL_MS`, `TROVO_CHATBOT_COMMANDS_REFRESH_SECONDS`

### 3.5 Kick runner

- **File**: `src/bots/kickChatbotRunner.ts`
- **Run**: `pnpm build && pnpm start:kick-chatbot`
- **What it does**:
  - syncs `KickChatBotSubscription(enabled=true)` (+ optional gate `BotIntegrationSettings(provider=kick)`)
  - ensures Kick event subscriptions (on Kick side) exist for webhook `POST /webhooks/kick/events`
  - sends chat messages (global/per-channel bot token) and processes outbox
  - sends credits chatter
  - (optional) can poll chat via `KICK_CHAT_POLL_URL_TEMPLATE` as a fallback/addition
- **ENV (minimum)**:
  - `CHATBOT_BACKEND_BASE_URLS`
  - `KICK_SEND_CHAT_URL`
  - `KICK_CHAT_BOT_ENABLED` (if `0|false|off` — the worker exits)
  - for correct callback URL: `DOMAIN` (or explicit `KICK_WEBHOOK_CALLBACK_URL`)
- **Optional**:
  - `KICK_CHAT_POLL_URL_TEMPLATE` (poll URL template; variables `{channelId}`, `{cursor}`)
  - `KICK_CHATBOT_SYNC_SECONDS`, `KICK_CHATBOT_OUTBOX_POLL_MS`, `KICK_CHATBOT_COMMANDS_REFRESH_SECONDS`, `KICK_CHATBOT_INGEST_POLL_MS`

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
