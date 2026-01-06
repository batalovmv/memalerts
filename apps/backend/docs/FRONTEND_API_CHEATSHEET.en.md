# MemAlerts Backend — Frontend API Cheat Sheet

No fluff: **all HTTP requests in the project + what to send / what you get back**.  
Source of truth: `src/routes/*`, `src/controllers/*`, `src/shared/schemas.ts`, `src/socket/index.ts`.

## Basics (important for frontend)

- **Base URL**: backend domain (prod) or beta backend domain (beta).
- **Auth**: JWT is stored in **httpOnly cookie**:
  - prod: `token`
  - beta: `token_beta` (isolated from prod)
  - On the frontend always send requests with `credentials: 'include'`.
- **Public vs "public"**:
  - **`/channels/*`** — “channel” endpoints. On **prod** they’re public; on **beta** they are gated (see below).
  - **`/public/*`** — guest read/control endpoints with “sanitized” DTOs. They are **available to guests on both prod and beta** (important for public pages and external integrations).
- **Beta cookie key selection (important for 401)**:
  - `/auth/:provider/link` is protected by `authenticate`, and you’ll get 401 if backend doesn’t see the right cookie.
  - On the **beta instance**, backend expects **`token_beta`** (and may accept fallback `token` only for backward compatibility).
  - Beta/Prod is determined not only by `Host`, but also by **instance** (e.g. `PORT=3002`, `DOMAIN` contains `beta.`, or `INSTANCE=beta`) — this protects against cases where frontend reaches beta API through a shared proxy/upstream.
- **CSRF**: for `POST/PUT/PATCH/DELETE` in production, `Origin`/`Referer` from allowed origins (CORS) is **required**.  
  Exceptions: `/internal/*`, `/webhooks/*`, `/health`, `/public/*`, `/auth/twitch*`.  
  Note: `POST /auth/logout` is still CSRF-protected (in prod), but it’s allowed without `Origin` only in a narrow case when the browser explicitly marks the request as same-site (`Sec-Fetch-Site: same-origin|same-site`).
- **Uploads**: static files are available at `GET /uploads/...` (the URLs returned as `fileUrl` / `fileUrlTemp`).
- **Enums** (see `src/shared/schemas.ts`):
  - `SubmissionStatus`: `pending | needs_changes | approved | rejected`
  - `MemeStatus`: `pending | approved | rejected` (+ soft-delete uses `status='deleted'` and `deletedAt`)
  - `ActivationStatus`: `queued | playing | done | failed`
  - `UserRole`: `viewer | streamer | admin`

## Public / Viewer API

### GET `/health`
- **Auth**: none
- **Response**:
  - `{ "status": "ok", "build": { name, version, deployTrigger }, "instance": { port, domain, instance } }`

### Public guest read API (works on both prod and beta)

### GET `/public/channels/:slug`
- **Auth**: optional (`optionalAuthenticate`)
- **Query**:
  - `includeMemes` (`true|false`, default `false`)
  - `limit`, `offset` — pagination if `includeMemes=true`
  - `sortBy`: `createdAt | priceCoins` (default `createdAt`)
  - `sortOrder`: `asc | desc` (default `desc`)
- **Response**: “public” channel DTO (without internal fields), includes:
  - `id`, `slug`, `name`
  - `coinIconUrl`, `primaryColor`, `secondaryColor`, `accentColor`
  - `rewardTitle`, `rewardOnlyWhenLive`
  - `submissionRewardCoins`, `submissionRewardOnlyWhenLive`
  - `submissionsEnabled`, `submissionsOnlyWhenLive`
  - `owner`: `{ id, displayName, profileImageUrl } | null`
  - `stats`: `{ memesCount, usersCount }`
  - if `includeMemes=true`: `memes` + `memesPage` (same shape as `GET /channels/:slug`)

### GET `/public/channels/:slug/memes`
- **Auth**: optional
- **Query**: `limit` (default 30), `offset` (default 0), `sortBy`, `sortOrder`
- **Response**: array of memes (catalog depends on `memeCatalogMode`; see `GET /channels/:slug`)

### GET `/public/channels/:slug/memes/search`
- **Auth**: optional
- **Query**: `q`, `limit`, `offset`, `sortBy`, `sortOrder`
- **Response**: array of “sanitized” memes (no private fields)

### Public token-based control (StreamDeck / StreamerBot)

These endpoints **do not use auth cookies** and are protected by a **per-channel secret token** (query `token`).

### GET `/public/submissions/status?token=...`
- **Response**: `{ ok: true, submissions: { enabled: boolean, onlyWhenLive: boolean } }`

### POST `/public/submissions/enable?token=...`
### POST `/public/submissions/disable?token=...`
### POST `/public/submissions/toggle?token=...`
- **Response**: `{ ok: true, submissions: { enabled: boolean, onlyWhenLive: boolean } }`
- **Realtime side-effects**: emits `submissions:status { enabled, onlyWhenLive }` to `channel:{slugLower}`

### GET `/channels/:slug`
- **Auth**:
  - prod: public
  - beta: `authenticate + requireBetaAccess`
- **Query**:
  - `includeMemes` (`true` by default). `includeMemes=false` — only meta (for fast first render).
  - `limit`, `offset` — memes pagination if `includeMemes=true`
- **Response**:
  - `id`, `slug`, `name`
  - `memeCatalogMode`: `"channel" | "pool_all"`
  - `coinPerPointRatio`
  - `rewardIdForCoins`, `rewardEnabled`, `rewardTitle`, `rewardCost`, `rewardCoins`
  - `rewardOnlyWhenLive` (boolean, default `false`) — award coins for Twitch reward only when the stream is live
  - **Kick rewards**: `kickRewardEnabled`, `kickRewardIdForCoins`, `kickCoinPerPointRatio`, `kickRewardCoins`, `kickRewardOnlyWhenLive`
  - **Trovo spells**: `trovoManaCoinsPerUnit`, `trovoElixirCoinsPerUnit`
  - **VKVideo rewards**: `vkvideoRewardEnabled`, `vkvideoRewardIdForCoins`, `vkvideoCoinPerPointRatio`, `vkvideoRewardCoins`, `vkvideoRewardOnlyWhenLive`
  - `youtubeLikeRewardEnabled` (boolean, default `false`)
  - `youtubeLikeRewardCoins` (int, default `0`)
  - `youtubeLikeRewardOnlyWhenLive` (boolean, default `false`)
  - `submissionRewardCoins`
  - `submissionRewardOnlyWhenLive` (boolean, default `false`) — award coins for approved submission only when the stream is live
  - `submissionsEnabled` (boolean, default `true`)
  - `submissionsOnlyWhenLive` (boolean, default `false`)
  - `coinIconUrl`
  - `primaryColor`, `secondaryColor`, `accentColor`
  - `overlayMode`, `overlayShowSender`, `overlayMaxConcurrent`
  - `dashboardCardOrder` (array string | null) — dashboard card order (if `null` — default)
  - `createdAt`
  - `owner`: `{ id, displayName, profileImageUrl } | null`
  - `stats`: `{ memesCount, usersCount }`
  - if `includeMemes=true`:
    - `memes`: array
      - mode `"channel"`: `{ id,title,type,fileUrl,durationMs,priceCoins,createdAt }` (id = `ChannelMeme.id`)
      - mode `"pool_all"`: `{ id, channelMemeId, memeAssetId, title, type, fileUrl, durationMs, priceCoins, createdAt }` (id = `MemeAsset.id`)
    - `memesPage`: `{ limit, offset, returned, total }`

### GET `/channels/:slug/memes`
- **Auth**:
  - prod: public
  - beta: `authenticate + requireBetaAccess`
- **Query**: `limit` (default 30), `offset` (default 0)
- **Response**: array of memes (catalog depends on `memeCatalogMode`):
  - mode `"channel"`: `{ id, channelId, title, type, fileUrl, durationMs, priceCoins, status, createdAt, createdBy: { id, displayName } }` (id = `ChannelMeme.id`)
  - mode `"pool_all"`: `{ id, channelId, channelMemeId, memeAssetId, title, type, fileUrl, durationMs, priceCoins, createdAt, createdBy }` (id = `MemeAsset.id`)

### GET `/channels/:slug/wallet`
- **Auth**: `authenticate + requireBetaAccess`
- **Response**: wallet (upsert; if none existed — it will create it)
  - `{ id, userId, channelId, balance, updatedAt }`

### GET `/me`
- **Auth**: `authenticate + requireBetaAccess`
- **Response**:
  - `{ id, displayName, profileImageUrl, role, isGlobalModerator, channelId, channel, wallets, externalAccounts }`
  - `isGlobalModerator`: boolean (true for `admin` or for an active global moderator grant)
  - `channel`: `{ id, slug, name } | null`
  - `wallets`: array of wallet rows
  - `externalAccounts`: array of linked accounts (see `/auth/accounts`)

### POST `/rewards/youtube/like/claim`
- **Auth**: `authenticate + requireBetaAccess`
- **Body**:
  - `channelSlug` (string, required)
  - `videoId` (string, optional) — if not provided, backend will try to detect current live `videoId`
- **Response**: `{ status: string, ... }`
  - `status`:
    - `disabled` — feature off / coins=0
    - `need_youtube_link` — user has no YouTube `ExternalAccount`
    - `need_relink_scopes` — needs `youtube.force-ssl` (see `GET /auth/youtube/link/force-ssl`)
    - `not_live` — couldn’t detect current live `videoId` (or onlyWhenLive=true and `videoId` doesn’t match)
    - `cooldown` — checks too frequent
    - `not_liked` — like not found
    - `already_awarded` — already awarded for this `videoId`
    - `awarded` — awarded (response includes `coinsGranted`, `balance`)

### GET `/me/preferences`
- **Auth**: `authenticate + requireBetaAccess`
- **Response**:
  - `{ theme, autoplayMemesEnabled, memeModalMuted, coinsInfoSeen }`
  - `theme`: `"light" | "dark"`
- **Behavior**:
  - if there’s no row in DB yet — returns defaults:
    - `theme="light"`
    - `autoplayMemesEnabled=true`
    - `memeModalMuted=false`
    - `coinsInfoSeen=false`

### PATCH `/me/preferences`
- **Auth**: `authenticate + requireBetaAccess`
- **Body (JSON)**: partial object (any subset of fields)
  - `{ theme?, autoplayMemesEnabled?, memeModalMuted?, coinsInfoSeen? }`
- **Response**:
  - **full** preferences object (merged/current): `{ theme, autoplayMemesEnabled, memeModalMuted, coinsInfoSeen }`

### GET `/wallet`
- **Auth**: `authenticate + requireBetaAccess`
- **Query**: `channelId` (required)
- **Response**:
  - wallet row `{ id, userId, channelId, balance, updatedAt }`
  - if wallet not found — returns object with `balance: 0` and `id: ""`

### GET `/memes`
- **Auth**: `authenticate + requireBetaAccess`
- **Query**:
  - `channelSlug` **or** `channelId` (if neither provided — 400)
  - `limit`, `offset` (optional)
- **Response**: array of channel memes (approved, `deletedAt=null`) with `createdBy`:
  - `{ id, channelMemeId, memeAssetId, title, type, fileUrl, durationMs, priceCoins, status, createdAt, createdBy }`
  - `id` — back-compat (legacy `Meme.id` if exists, otherwise `ChannelMeme.id`)

### GET `/channels/memes/search`
- **Auth**:
  - prod: public, **optional auth** (for `favorites=1`)
  - beta: `authenticate + requireBetaAccess`
- **Query**:
- `q` — search (mode depends on `channelId|channelSlug` presence and `memeCatalogMode`)
  - `tags` — string `tag1,tag2` (tag names)
  - `channelId` or `channelSlug` (filter)
  - `minPrice`, `maxPrice`
  - `sortBy`: `createdAt | priceCoins | popularity`
  - `sortOrder`: `asc | desc`
  - `includeUploader=1` (for dashboard search by uploader)
  - `favorites=1` (returns user’s favorites — requires auth and channelId/slug)
  - `limit` (default 50, clamped by env), `offset`
- **Response**: **2 response modes** (important for frontend):
  - **Channel listing/search DTO (preferred for channel storefront)**:
    - when `channelId|channelSlug` is provided and request matches “channel listing/search”
    - response item: `{ id, channelId, channelMemeId, memeAssetId, title, type, fileUrl, durationMs, priceCoins, status, deletedAt: null, createdAt, createdBy }`
    - for `memeCatalogMode="pool_all"` item is built from `MemeAsset` (id = `MemeAsset.id`, `channelMemeId` is virtual)
  - **Legacy Meme search DTO (for popularity/global search/complex filters)**:
    - response item: `Meme` (approved) with `createdBy`, `tags: [{ tag: { id, name } }]` and `_count.activations` (for popularity)

### GET `/memes/pool`
- **Auth**:
  - prod: public
  - beta: `authenticate + requireBetaAccess`
- **Query**: `q` (optional), `limit` (default 50), `offset` (default 0)
- **Response**: array `{ id, type, fileUrl, durationMs, createdAt, usageCount, sampleTitle, samplePriceCoins }`

### GET `/memes/stats`
- **Auth**:
  - prod: public, optional auth (auth excludes “self” from stats)
  - beta: `authenticate + requireBetaAccess`
- **Query**:
  - `period`: `day | week | month | year | all` (default `month`)
  - `limit` (default 10)
  - `channelId` or `channelSlug` (optional)
- **Response**:
  - `{ period, startDate, endDate, stats }`
  - `stats`: array `{ meme: { id, title, priceCoins, tags } | null, activationsCount, totalCoinsSpent }`
  - sometimes includes `rollup` (which table was used)

### POST `/memes/:id/activate`
- **Auth**: `authenticate + requireBetaAccess`
- **Body**: none (id is taken from URL)
- **id can be**:
  - `ChannelMeme.id` (preferred)
  - legacy `Meme.id` (back-compat)
  - `MemeAsset.id` (if channel has `pool_all` catalog mode; then you must pass channel context)
- **Query (only for `MemeAsset.id`)**:
  - `channelSlug` or `channelId` (required)
- **Response**:
  - `{ activation, wallet, originalPrice, finalPrice, discountApplied, isFree }`
  - `activation`: `{ id, channelId, userId, memeId, coinsSpent, status: "queued", createdAt }`
  - `wallet`: `{ id, userId, channelId, balance, updatedAt }`
- **Realtime side-effects**:
  - to `channel:{slugLower}`: `activation:new { id, memeId, type, fileUrl, durationMs, title, senderDisplayName }`
  - to `user:{userId}`: `wallet:updated { userId, channelId, balance, delta, reason, channelSlug }` (if coins were spent)

## Auth (OAuth + account linking)

### GET `/auth/:provider`
- **Auth**: none
- **Query**:
  - `redirect_to` — where on the frontend to return after login (e.g. `/dashboard`)
- **Response**: redirect to OAuth provider
- **Supported provider (login)**: `twitch`  
  Other providers are currently supported **only** in account linking mode (`/auth/:provider/link`).
- **Important**:
  - on first login the user is created with `role="viewer"` **without auto-creating Channel** (channel is created only when user becomes a streamer via a separate action).

### GET `/auth/:provider/callback`
- **Auth**: none
- **Response**: redirect to frontend + sets cookie `token` or `token_beta`

### GET `/auth/twitch/complete`
- **Purpose**: exchange a temporary token for “prod callback → beta frontend”
- **Query**: `token`, `state`
- **Response**: redirect to frontend + sets cookie `token_beta`

### GET `/auth/:provider/link`
- **Auth**: `authenticate + requireBetaAccess`
- **Query**:
  - `redirect_to` (optional, default `/settings/accounts`)
- **redirect_to security**:
  - only **relative** paths like `/settings/accounts` are allowed
  - external URLs (`https://evil.com`, `//evil.com`) will be replaced with a safe default
- **Response**: redirect to OAuth provider to link an account to the current `User`
- **Supported provider (link)**:
  - `twitch` (full OAuth)
  - `youtube` (full OAuth via Google OpenID userinfo)
  - `discord` (full OAuth; needed for Boosty Discord roles / auto-join)
  - `vk` (full OAuth)
  - `vkvideo` (full OAuth VK Video Live, see `https://dev.live.vkvideo.ru/docs/main/authorization`)
  - `trovo` (full OAuth)
  - `kick` (full OAuth; OAuth endpoints configured via ENV)
  - `boosty` — **manual mode** (redirects to frontend with `provider=boosty&mode=manual`, then linking is done via `POST /auth/boosty/link`)
- **If user is not logged in**: redirects to frontend with `/?error=auth_required&reason=no_session`
- **If you see `401 Unauthorized` instead of redirect**:
  - Frontend request **did not include cookies** → ensure `credentials: 'include'` (and enable credentials in fetch/axios).
  - Cookies didn’t arrive due to CORS → backend must return `Access-Control-Allow-Credentials: true` and a concrete `Access-Control-Allow-Origin` (not `*`).
  - Cookie set on a different domain/subdomain (Domain mismatch) → `token_beta` must be available for the API domain actually used.
  - Backend logs on 401 now include `auth.no_token_cookie` (shows `host/origin` and cookie key list, without values).

#### YouTube linking (important for bot chat messages)
- Streamer YouTube linking requests only read-only scope:
  - `https://www.googleapis.com/auth/youtube.readonly`
- Sending chat messages is done **not as the streamer**, but as a shared MemAlerts bot account (server-side).
  - Server must have `YOUTUBE_BOT_REFRESH_TOKEN` configured (bot account with `youtube.force-ssl`).
- If user linked YouTube earlier and didn’t grant the scope — they need to **re-link YouTube** (via `GET /auth/youtube/link`).

### GET `/auth/youtube/link/force-ssl`
- **Auth**: `authenticate + requireBetaAccess`
- **Purpose**: request extra scope `youtube.force-ssl` (needed for viewer rewards like `POST /rewards/youtube/like/claim`)
- **Response**: redirect to Google OAuth (same as `/auth/youtube/link`, but with expanded scopes)

### GET `/auth/:provider/link/callback`
- **Auth**: none (OAuth callback)
- **Response**: redirect to frontend (does not change cookie)  
  If the account is already linked to another user: redirect with `?error=auth_failed&reason=account_already_linked`

### GET `/auth/accounts`
- **Auth**: `authenticate + requireBetaAccess`
- **Response**:
  - `{ accounts: ExternalAccount[] }`, where `ExternalAccount` includes (at minimum):
    - `id`, `provider`, `providerAccountId`
    - `displayName`, `login`, `avatarUrl`, `profileUrl`
    - `createdAt`, `updatedAt`

### POST `/auth/boosty/link`
- **Auth**: `authenticate + requireBetaAccess`
- **Body (JSON)**:
  - `accessToken` (string) **or** `token` (string alias)
  - alternatively: `refreshToken` + `deviceId`
  - `blogName` (optional) — for UI/profile link
- **Response**: linked `ExternalAccount` (provider=`boosty`)
- **Common errors**:
  - `410 BOOSTY_LINK_DEPRECATED` — if rewards-through-Discord-roles mode is enabled
  - `400 BOOSTY_LINK_MISSING_CREDENTIALS`
  - `401 BOOSTY_INVALID_TOKEN`
  - `409 BOOSTY_ACCOUNT_ALREADY_LINKED`

### DELETE `/auth/accounts/:externalAccountId`
- **Auth**: `authenticate + requireBetaAccess`
- **CSRF**: yes (as for any `DELETE` in production)
- **Response**: `{ ok: true }`
- **Errors**:
  - `400` if it’s the last linked account (can’t unlink the last one)
  - `404` if account not found or doesn’t belong to current user

### POST `/auth/logout`
- **Auth**: none (can be called without cookie)
- **Response**: `{ "message": "Logged out successfully" }`  
  Clears **both** cookies: `token` and `token_beta` (with multiple domain variants).

### (Legacy) Twitch-only aliases
- `GET /auth/twitch` — legacy entrypoint (equivalent to `GET /auth/:provider` for `provider=twitch`)
- `GET /auth/twitch/callback` — legacy callback (equivalent to `GET /auth/:provider/callback` for `provider=twitch`)

## Submissions (upload / import / resubmit)

All `/submissions/*` require: **`authenticate + requireBetaAccess`**

### POST `/submissions`
- **Content-Type**: `multipart/form-data`
- **Form fields**:
  - `file` (required): video
  - `title` (string, 0..200; can be omitted/empty — server will set a placeholder and later AI may replace it)
  - `type`: strictly `"video"`
  - `notes` (string up to 500, optional)
  - `tags` (optional): **JSON-string** of string array (e.g. `["cat","lol"]`)
  - `durationMs` (optional): number, fallback if server couldn’t determine duration
  - `channelId` (optional): if omitted — taken from `req.channelId` from JWT
- **Response (2 variants)**:
  - if submitted by the channel owner (`streamer/admin` and `req.channelId === channelId`): returns **Meme** (approved) + `isDirectApproval: true`
    - additionally: `channelMemeId`, `memeAssetId`, `deletedAt: null`
  - otherwise: returns **MemeSubmission** (status `pending`)
- **Common errors**:
  - `403 SUBMISSIONS_DISABLED` / `403 SUBMISSIONS_OFFLINE`
  - `409 ALREADY_IN_CHANNEL` (if this asset already exists in the channel)
  - `413 VIDEO_TOO_LONG` (duration > 15s)

### POST `/submissions/import`
- **Body (JSON)**:
  - `{ title, sourceUrl, notes?, tags? }` (see `importMemeSchema`)
  - `sourceUrl` must be from `memalerts.com` or `cdns.memealerts.com`
  - `channelId` can be passed in body/query (otherwise from JWT)
- **Response**: `MemeSubmission` (status `pending`, `sourceUrl` filled)

### POST `/submissions/pool`
- **Body (JSON)**: `{ channelId, memeAssetId, title?, notes?, tags? }`
- **Purpose**: “take” a meme from the **global pool** into a channel via submission (for moderation).
- **Response (2 variants)**:
  - if submitted by the channel owner (`streamer/admin` and `req.channelId === channelId`): returns **Meme** (approved) + `isDirectApproval: true` + `sourceKind="pool"` + `channelMemeId`, `memeAssetId`
  - otherwise: `MemeSubmission` (status `pending`, `sourceKind="pool"`, `memeAssetId`, `sourceUrl` will be the asset link)
- **Errors**:
  - `404 MEME_ASSET_NOT_FOUND` (asset hidden/quarantined/purged or has no fileUrl)
  - `409 ALREADY_IN_CHANNEL`

### GET `/submissions` and GET `/submissions/mine`
- **Response**: array of user submissions:
  - `{ id, channelId, submitterUserId, title, type, fileUrlTemp, sourceUrl, sourceKind, memeAssetId, notes, status, moderatorNotes, revision, createdAt, tags }`
  - `tags`: array `{ tag: { id, name } }`

### POST `/submissions/:id/resubmit`
- **Body (JSON)**: `{ title, notes?, tags? }`
- **Conditions**:
  - current submission status must be `needs_changes`
  - retry limit: env `SUBMISSION_MAX_RESUBMITS` (default 2)
- **Response**: updated submission (status becomes `pending` again, `revision++`)

## Streamer panel (`/streamer/*`)

Requires: `authenticate + requireBetaAccess` + role **`streamer|admin`**

### GET `/streamer/submissions`
- **Query**:
  - `status` (optional)
  - `limit`, `offset` (optional)
  - `includeTotal=1` (optional, returns total)
  - `includeTags=0` to speed up list (tags included by default)
- **Response**:
  - back-compat: if no paging — array
  - with paging: `{ items, total }`
  - `items` fields: `id, channelId, submitterUserId, title, type, fileUrlTemp, sourceUrl, notes, status, moderatorNotes, revision, createdAt, submitter{ id, displayName }, tags?`

### POST `/streamer/submissions/:id/approve`
- **Body (JSON)** (see `approveSubmissionSchema`):
  - `priceCoins?` (default 100 / or channel.defaultPriceCoins)
  - `durationMs?` (default 15000; server tries to read real duration)
  - `tags?` (string array)
- **Response**: created **Meme** (approved)
- **Realtime side-effects**:
  - `submission:approved` to `channel:{slugLower}`
  - may emit `wallet:updated` to submitter (if `submissionRewardCoins > 0`)

### POST `/streamer/submissions/:id/reject`
- **Body (JSON)**: `{ moderatorNotes? }`
- **Response**: updated submission (status `rejected`)
- **Realtime**: `submission:rejected`

### POST `/streamer/submissions/:id/needs-changes`
- **Body (JSON)**: `{ moderatorNotes }` (required)
- **Response**: updated submission (status `needs_changes`)
- **Realtime**: `submission:needs_changes` (in channel room + in `user:{submitterId}`)

### GET `/streamer/memes`
- **Query**:
  - `q` (search by title)
  - `status`: `pending|approved|rejected|deleted|all` (default: “not deleted”)
  - `limit`, `offset` (if `all!=1`)
  - `sortOrder=asc|desc`
  - `includeTotal=1` (via header `X-Total-Count`)
  - `all=1` — legacy (no limit; not recommended)
- **Response**: array of memes (paging headers: `X-Limit`, `X-Offset`, `X-Has-More`, `X-Total-Count?`)

### PATCH `/streamer/memes/:id`
- **Body (JSON)**: `{ title?, priceCoins?, durationMs? }`
- **Response**: updated meme (with `createdBy`, `approvedBy`)

### DELETE `/streamer/memes/:id`
- **Response**: soft-deleted meme (`status: "deleted"`, `deletedAt`)

### PATCH `/streamer/channel/settings`
- **Body (JSON)**: see `updateChannelSettingsSchema` (reward + live-only flags + colors + overlay + `submissionRewardCoins`)
- **Body example**:
  - `{ "rewardOnlyWhenLive": true, "submissionRewardOnlyWhenLive": false }`
- **Response**: updated Channel row (many fields; frontend cares about fields from schema)
- **Realtime**: `overlay:config` to `channel:{slugLower}` (so OBS doesn’t reload)
- **Twitch-only guard**:
  - if `Channel.twitchChannelId == null`, trying to enable/update Twitch reward returns `400`:
    - `{ errorCode: "TWITCH_CHANNEL_NOT_LINKED" }`

### GET `/streamer/twitch/reward/eligibility`
- **Response**:
  - `{ eligible: true|false|null, broadcasterType, checkedBroadcasterId, reason? }`
  - on beta may add `debug`

### Public control links (StreamDeck / StreamerBot)

- **GET `/streamer/submissions-control/link`** → `{ url, token, rotatedAt? }` (token-based public control, see `/public/submissions/*`)
- **POST `/streamer/submissions-control/link/rotate`** → `{ url, token }`

### Promotions
- **GET `/streamer/promotions`** → array promotions (or `[]` if table doesn’t exist / timeout)
- **POST `/streamer/promotions`** body: `{ name, discountPercent, startDate, endDate }` (ISO datetime)
- **PATCH `/streamer/promotions/:id`** body: `{ name?, discountPercent?, startDate?, endDate?, isActive? }`
- **DELETE `/streamer/promotions/:id`** → `{ success: true }`

### GET `/streamer/stats/channel`
- **Response**:
  - `overall`: `{ totalActivations, totalCoinsSpent, totalMemes }`
  - `userSpending`: array `{ user: {id,displayName}, totalCoinsSpent, activationsCount }`
  - `memePopularity`: array `{ meme: {id,title,priceCoins}|null, activationsCount, totalCoinsSpent }`
  - `daily`: array `{ day: ISO, activations, coins, source: "rollup"|"raw" }`
  - `rollup`: `{ windowDays, userSpendingSource, memePopularitySource }`

### OBS Meme Overlay
- **GET `/streamer/overlay/token`** → `{ token, overlayMode, overlayShowSender, overlayMaxConcurrent, overlayStyleJson }`
- **POST `/streamer/overlay/token/rotate`** → `{ token, overlayMode, overlayShowSender, overlayMaxConcurrent }`
- **GET `/streamer/overlay/preview-meme`** → `{ meme: { id,type,fileUrl,title,channelId } | null }`
- **GET `/streamer/overlay/preview-memes?count=1..5&seed=string`** → `{ memes: [{ id,type,fileUrl,title,channelId }] }`
- **GET `/streamer/overlay/presets`** → `{ presets: [...] }`
- **PUT `/streamer/overlay/presets`** body `{ presets: [...] }` → `{ ok: true }`
  - limits:
    - `presets.length <= 30`
    - total JSON size is limited (413 if too large)
  - preset shape (example):
    - `{ id: "p_...", name: "My preset", createdAt: 173..., payload: { v:1, overlayMode:"queue", overlayShowSender:true, overlayMaxConcurrent:3, style:{...} } }`

### OBS Credits Overlay
- **GET `/streamer/credits/token`** → `{ token, creditsStyleJson }`
- **GET `/streamer/credits/state`** → `{ chatters, donors }`
- **GET `/streamer/credits/reconnect-window`** → `{ creditsReconnectWindowMinutes }`
- **GET `/streamer/credits/ignored-chatters`** → `{ items: string[] }`
- **POST `/streamer/credits/ignored-chatters`** body `{ items: string[] }` → `{ ok: true, items }`
- **POST `/streamer/credits/settings`** body: `{ creditsStyleJson: string }` (can be empty string → clears) → `{ ok, creditsStyleJson }`
- **POST `/streamer/credits/token/rotate`** → `{ token }`
- **POST `/streamer/credits/reset`** → `{ ok: true }`
- **POST `/streamer/credits/reconnect-window`** body: `{ minutes }` → `{ creditsReconnectWindowMinutes }`

### Chat bot (streamer panel)
- **Developer docs for running/ENV/debugging bots**: `docs/BOTS.md`
- **POST `/streamer/bot/enable`** → `{ ok: true }`
- **POST `/streamer/bot/disable`** → `{ ok: true }`
- **POST `/streamer/bot/say`** body:
  - `{ message }` → sends to **Twitch** (if Twitch bot is enabled for the channel)
  - `{ provider: "youtube", message }` → sends to **YouTube** (if YouTube bot is enabled for the channel)
  - `{ provider: "vkvideo", message }` → sends to **VKVideo** (if VKVideo bot is enabled for the channel)
  - response: `{ ok, outbox: { id, status, createdAt } }`
- **GET `/streamer/bot/outbox/:provider/:id`** → `{ id, provider, status, createdAt, updatedAt, lastError? }`
- **Twitch-only guard**:
  - if `Channel.twitchChannelId == null`, then `enable/disable` and follow-greetings enable return `400`:
    - `{ error: "Bad Request", message: "This channel is not linked to Twitch" }`
- **GET `/streamer/bot/commands`** → `{ items: [{ id, trigger, response, enabled, onlyWhenLive, allowedRoles, allowedUsers, createdAt, updatedAt }] }`
- **POST `/streamer/bot/commands`**
  - body `{ trigger, response, onlyWhenLive?, allowedRoles?, allowedUsers? }` → `201` command row; `409` if trigger already exists
  - `onlyWhenLive` (optional, default `false`) — bot answers only when stream is live
  - `allowedRoles` (optional) — array: `["vip","moderator","subscriber","follower"]`
  - `allowedUsers` (optional) — array of Twitch logins (lowercase, without `@`), max 100 (validated by regex `^[a-z0-9_]{1,25}$`)
  - **default rule**: if `allowedRoles=[]` and `allowedUsers=[]` → anyone can trigger the command
  - ⚠️ Twitch IRC “follower” role is not derived from IRC tags (needs separate Helix check + cache); currently only whitelist by `allowedUsers` and roles `vip/moderator/subscriber` work in practice
- **PATCH `/streamer/bot/commands/:id`**
  - body `{ enabled?, onlyWhenLive?, allowedRoles?, allowedUsers? }` → updated command row
  - body is partial; you must pass **at least one** field (any of the 4)
- **DELETE `/streamer/bot/commands/:id`** → `{ ok: true }`
- **GET `/streamer/bot/subscription`** → `{ enabled }` (if no subscription row — `enabled: false`)

### Bot integrations (streamer panel)
- **GET `/streamer/bots`** → `{ items: [{ provider: "twitch"|"vkvideo"|"youtube"|"trovo"|"kick", enabled, updatedAt }] }`
- **GET `/streamer/bots/vkvideo/candidates`** → `{ items: [{ id, name, profileUrl? }] }` (if VKVideo account is linked and user has multiple channels)
- **PATCH `/streamer/bots/:provider`** → `{ ok: true }`
  - body for all providers: `{ enabled: boolean }`
  - **additionally for `provider="vkvideo"` when `enabled=true`**, pass `vkvideoChannelId`:
    - body: `{ enabled: true, vkvideoChannelId: string }`
    - or enable without `vkvideoChannelId`: `{ enabled: true }` — backend will try to detect channel via VKVideo `GET /v1/current_user` (requires VKVideo account linking). If multiple channels — pass `vkvideoChannelId` explicitly.
  - **Important (runners)**: enabling via this endpoint updates DB state, but messages/commands will work only if the corresponding worker is running (see `docs/BOTS.md`).
  - **Twitch-only guard**: for `provider="twitch"` and `Channel.twitchChannelId == null` returns `400` just like `/streamer/bot/enable`.
  - ⚠️ if feature isn’t deployed / migrations not applied yet — backend may return `404` (frontend should show “unavailable”).

#### Entitlements (subscription gates)
- **GET `/streamer/entitlements/custom-bot`** → `{ entitled: boolean }`
  - `entitled=true` means the channel is allowed to use **per-channel override bot sender** (custom bot) for Twitch/YouTube/VKVideo.
  - `entitled=false` means override cannot be linked/used; the system must always fall back to the global bot.

#### Per-channel bot override linking (custom bot sender)
These endpoints manage linking a “custom bot” (per-channel override), separate from enabling integration via `PATCH /streamer/bots/:provider`.

- **GET `/streamer/bots/twitch/bot`** → `{ enabled, externalAccountId, updatedAt, lockedBySubscription }`
- **GET `/streamer/bots/youtube/bot`** → `{ enabled, externalAccountId, updatedAt, lockedBySubscription }`
- **GET `/streamer/bots/vkvideo/bot`** → `{ enabled, externalAccountId, updatedAt, lockedBySubscription }`
- **GET `/streamer/bots/trovo/bot`** → `{ enabled, externalAccountId, updatedAt, lockedBySubscription }`
- **GET `/streamer/bots/kick/bot`** → `{ enabled, externalAccountId, updatedAt, lockedBySubscription }`
  - `externalAccountId`: linked sender account (if any).
  - `lockedBySubscription=true`: linking exists, but **using the override is forbidden** (no `custom_bot` entitlement). UI should show “Locked by subscription” and prompt to upgrade.

- **GET `/streamer/bots/twitch/bot/link`** → redirect to OAuth to link override
- **GET `/streamer/bots/youtube/bot/link`** → redirect to OAuth to link override
- **GET `/streamer/bots/vkvideo/bot/link`** → redirect to OAuth to link override
- **GET `/streamer/bots/trovo/bot/link`** → redirect to OAuth to link override
- **GET `/streamer/bots/kick/bot/link`** → redirect to OAuth to link override
  - **If subscription/entitlement missing**: returns `403` JSON:
    - `{ error: "Forbidden", code: "SUBSCRIPTION_REQUIRED", message }`
  - UX: do not do a “blind” `window.location.href` without a preflight — otherwise user will see raw JSON.

- **DELETE `/streamer/bots/twitch/bot`** → `{ ok: true }` (unlink override)
- **DELETE `/streamer/bots/youtube/bot`** → `{ ok: true }` (unlink override)
- **DELETE `/streamer/bots/vkvideo/bot`** → `{ ok: true }` (unlink override)
- **DELETE `/streamer/bots/trovo/bot`** → `{ ok: true }` (unlink override)
- **DELETE `/streamer/bots/kick/bot`** → `{ ok: true }` (unlink override)

Note about OAuth callback (bot_link):
- If during `bot_link` you attempted to apply per-channel override without entitlement, backend will **not create/update** `*BotIntegration` and will redirect to frontend with:
  - `?error=auth_failed&reason=subscription_required&provider=<twitch|youtube|vkvideo>`
- **YouTube enable may require relink**:
  - if user has YouTube linked without required permissions/refresh token — backend returns `412 Precondition Failed`:
    - `code: "YOUTUBE_RELINK_REQUIRED"`
    - `needsRelink: true`
    - `reason` and (optional) `requiredScopesMissing: string[]`
  - UX: show button “Re-connect YouTube” → open `GET /auth/youtube/link` (with `redirect_to=/settings/accounts` or current page if allowlisted).
  - if server YouTube bot is not configured — backend returns `503`:
    - `code: "YOUTUBE_BOT_NOT_CONFIGURED"`
- **GET `/streamer/bot/follow-greetings`** → `{ followGreetingsEnabled, followGreetingTemplate }`
- **POST `/streamer/bot/follow-greetings/enable`** body optional `{ followGreetingTemplate }` → `{ ok, followGreetingsEnabled, followGreetingTemplate }`
- **POST `/streamer/bot/follow-greetings/disable`** → `{ ok, followGreetingsEnabled, followGreetingTemplate }`
- **PATCH `/streamer/bot/follow-greetings`** body `{ followGreetingTemplate }` → `{ ok, followGreetingsEnabled, followGreetingTemplate }`
- **GET `/streamer/bot/stream-duration`** → `{ enabled, trigger, responseTemplate, breakCreditMinutes, onlyWhenLive }`
- **PATCH `/streamer/bot/stream-duration`** body `{ enabled, trigger, responseTemplate, breakCreditMinutes, onlyWhenLive }` → same fields

#### “Smart” bot command: stream duration
- **Purpose**: bot answers a command (e.g. `!time`) with stream duration — **sum of online time** for the current session.
- **Break credit**: offline gap **<= `breakCreditMinutes`** does not break the session; if **> `breakCreditMinutes`** — it’s considered a new stream (timer “resets”).
- **responseTemplate**: string (or `null`) with placeholders:
  - `{hours}` — hours (integer)
  - `{minutes}` — minutes (remainder 0..59)
  - `{totalMinutes}` — total minutes (integer)
- **onlyWhenLive**: if `true` — bot answers only when stream is live (if offline — bot stays silent).
- **Defaults** (if settings not saved yet):
  - `enabled=false`
  - `trigger="!time"`
  - `responseTemplate="Stream time: {hours}h {minutes}m ({totalMinutes}m)"`
  - `breakCreditMinutes=60`
  - `onlyWhenLive=false`
- **Important**: if feature isn’t deployed / migrations not applied yet — backend may return `404` (frontend should show “unavailable”).

## Owner panel (`/owner/*`) — admin only

Requires: `authenticate + requireBetaAccess` + role **admin**

### GET `/owner/wallets/options`
- **Response**: `{ users, channels }` (for dropdowns)
  - `users`: `{ id, displayName, twitchUserId }[]`
  - `channels`: `{ id, name, slug }[]`

### GET `/owner/wallets`
- **Query (filters/paging)**:
  - `userId`, `channelId`, `q` (by user/channel)
  - `limit`, `offset`
  - `includeTotal=1`
- **Response**:
  - back-compat: array (if no filters)
  - otherwise: `{ items, total }`, where `items`:
    - `{ id, userId, channelId, balance, updatedAt, user, channel }`

### POST `/owner/wallets/:userId/:channelId/adjust`
- **Body (JSON)**: `{ amount: number }` (can be + or -; resulting balance cannot become < 0)
- **Response**: updated wallet (with `user`, `channel`)

### Default bot credentials (admin-only, global shared sender)

- **GET `/owner/bots/youtube/default/status`** → `{ enabled, externalAccountId, updatedAt }`
- **GET `/owner/bots/youtube/default/link`** → redirect to OAuth
- **DELETE `/owner/bots/youtube/default`** → `{ ok: true }`

- **GET `/owner/bots/vkvideo/default/status`** → `{ enabled, externalAccountId, updatedAt }`
- **GET `/owner/bots/vkvideo/default/link`** → redirect to OAuth
- **DELETE `/owner/bots/vkvideo/default`** → `{ ok: true }`

- **GET `/owner/bots/twitch/default/status`** → `{ enabled, externalAccountId, updatedAt }`
- **GET `/owner/bots/twitch/default/link`** → redirect to OAuth
- **DELETE `/owner/bots/twitch/default`** → `{ ok: true }`

- **GET `/owner/bots/trovo/default/status`** → `{ enabled, externalAccountId, updatedAt }`
- **GET `/owner/bots/trovo/default/link`** → redirect to OAuth
- **DELETE `/owner/bots/trovo/default`** → `{ ok: true }`

- **GET `/owner/bots/kick/default/status`** → `{ enabled, externalAccountId, updatedAt }`
- **GET `/owner/bots/kick/default/link`** → redirect to OAuth
- **DELETE `/owner/bots/kick/default`** → `{ ok: true }`

### Channel entitlements (admin-only)
Purpose: manually enable/disable subscription-gated features for a channel (until payment system/Stripe webhooks exist).

- **GET `/owner/entitlements/custom-bot?channelId=...`** → `{ channelId, key, enabled, expiresAt, source, active, updatedAt, createdAt }`
- **POST `/owner/entitlements/custom-bot/grant`** body: `{ channelId, expiresAt?, source? }` → `{ ok, channelId, key, active, expiresAt, source }`
- **POST `/owner/entitlements/custom-bot/revoke`** body: `{ channelId }` → `{ ok, channelId, key, active }`
- **GET `/owner/channels/resolve?provider=...&externalId=...`** → `{ ok, channelId, channelSlug, provider }`
- **POST `/owner/entitlements/custom-bot/grant-by-provider`** body: `{ provider, externalId, expiresAt?, source? }` → `{ ok, channelId, ... }`

### Global meme pool moderation (admin-only)

- **GET `/owner/meme-assets`** → `{ items, total }` (filters/paging depend on UI)
- **POST `/owner/meme-assets/:id/hide`** → `{ ok: true }` (hide asset from global pool)
- **POST `/owner/meme-assets/:id/unhide`** → `{ ok: true }`
- **POST `/owner/meme-assets/:id/purge`** → `{ ok: true }` (quarantine/purge; deletes asset at pool level)
- **POST `/owner/meme-assets/:id/restore`** → `{ ok: true }`

### Global moderators (admin-only)

- **GET `/owner/moderators`** → `{ items: [...] }`
- **POST `/owner/moderators/:userId/grant`** → `{ ok: true }`
- **POST `/owner/moderators/:userId/revoke`** → `{ ok: true }`

## Beta access (`/beta/*` and `/owner/beta/*`)

### POST `/beta/request`
- **Auth**: `authenticate`
- **Response**: `{ message, request }` (creates/updates BetaAccess)

### GET `/beta/status`
- **Auth**: `authenticate`
- **Response**: `{ hasAccess: boolean, request: { id,status,requestedAt,approvedAt } | null }`

### Admin beta management (all: `authenticate + role=admin`)
- **GET `/owner/beta/requests`** → array of requests (pending/approved/rejected)
- **POST `/owner/beta/requests/:id/approve`** → `{ message, request }` (and `user.hasBetaAccess=true`)
- **POST `/owner/beta/requests/:id/reject`** → `{ message, request }`
- **GET `/owner/beta/users`** → array of users with access + `betaAccess`
- **GET `/owner/beta/users/revoked`** → array revoked
- **POST `/owner/beta/users/:userId/revoke`** → `{ message, userId }`
- **POST `/owner/beta/users/:userId/restore`** → `{ message, userId }`

## Webhooks / Internal (not for frontend)

- **POST `/webhooks/twitch/eventsub`** — Twitch EventSub (HMAC), frontend doesn’t need it.
- **`/internal/*`** — localhost-only relay between prod/beta and credits events; frontend doesn’t need it.

## Socket.IO (Realtime)

### Connection
- Client connects to Socket.IO on the same backend origin; use `withCredentials` / cookies for dashboard joins.

### Rooms (names)
- `channel:{slugLower}` — overlay + streamer panel for one channel
- `user:{userId}` — personal user events (wallet, submissions)

### Client → Server events

- **`join:overlay`** `{ token }`
  - token is obtained via HTTP:
    - meme overlay: `GET /streamer/overlay/token`
    - credits overlay: `GET /streamer/credits/token`
- **`join:channel`** `(channelSlug)`
  - only authenticated `streamer/admin`, and slug must match the user’s channel
- **`join:user`** `(userId)`
  - allowed only if `userId === auth.userId`
- **`activation:ackDone`** `{ activationId }`
  - sets activation `status=done`

### Server → Client events

- **Overlay**:
  - `overlay:config` → `{ overlayMode, overlayShowSender, overlayMaxConcurrent, overlayStyleJson }`
  - `activation:new` → `{ id, memeId, type, fileUrl, durationMs, title, senderDisplayName }`
- **Wallet**:
  - `wallet:updated` → `{ userId, channelId, balance, delta?, reason?, channelSlug?, source? }` (**only** to `user:{id}`)
- **Submissions** (in `channel:{slugLower}` and optionally in `user:{id}`):
  - `submission:created|approved|rejected|needs_changes|resubmitted`
  - payload: `{ submissionId, channelId, submitterId?, moderatorId? }`
- **Credits overlay**:
  - `credits:config` → `{ creditsStyleJson }`
  - `credits:state` → `{ chatters: [{name}], donors: [{name,amount,currency}] }`





