# MemAlerts Backend — шпаргалка API для фронтенда

Без “воды”: **все HTTP запросы проекта + что отправлять/что получать**.  
Источник правды: `src/routes/*`, `src/controllers/*`, `src/shared/schemas.ts`, `src/socket/index.ts`.

## База (важно для фронта)

- **Base URL**: домен backend (prod) или beta backend (beta).
- **Auth**: JWT лежит в **httpOnly cookie**:
  - prod: `token`
  - beta: `token_beta` (изолирован от prod)
  - На фронте **всегда** делайте запросы с `credentials: 'include'`.
- **Beta cookie key selection (важно для 401)**:
  - `/auth/:provider/link` защищён `authenticate`, и 401 будет, если backend не увидит правильную cookie.
  - На **beta-инстансе** backend ожидает **`token_beta`** (и может принимать fallback `token` только для совместимости).
  - Beta/Prod определяется не только по `Host`, но и по **инстансу** (например `PORT=3002`, `DOMAIN` с `beta.`, или `INSTANCE=beta`) — это защищает от случаев, когда фронт ходит в beta API через общий proxy/upstream.
- **CSRF**: для `POST/PUT/PATCH/DELETE` в production **обязателен** `Origin`/`Referer` из разрешённых origin (CORS).  
  Исключения: `/internal/*`, `/webhooks/*`, `/health` (OAuth endpoints обычно `GET`, поэтому CSRF на них не применяется).
- **Uploads**: статика доступна по `GET /uploads/...` (файлы, которые вернул `fileUrl`/`fileUrlTemp`).
- **Enums** (см. `src/shared/schemas.ts`):
  - `SubmissionStatus`: `pending | needs_changes | approved | rejected`
  - `MemeStatus`: `pending | approved | rejected` (+ soft-delete использует `status='deleted'` и `deletedAt`)
  - `ActivationStatus`: `queued | playing | done | failed`
  - `UserRole`: `viewer | streamer | admin`

## Public / Viewer API

### GET `/health`
- **Auth**: нет
- **Response**:
  - `{ "status": "ok" }`

### GET `/channels/:slug`
- **Auth**:
  - prod: public
  - beta: `authenticate + requireBetaAccess`
- **Query**:
  - `includeMemes` (`true` по умолчанию). `includeMemes=false` — только мета (для быстрого первого рендера).
  - `limit`, `offset` — пагинация мемов, если `includeMemes=true`
- **Response**:
  - `id`, `slug`, `name`
  - `coinPerPointRatio`
  - `rewardIdForCoins`, `rewardEnabled`, `rewardTitle`, `rewardCost`, `rewardCoins`
  - `rewardOnlyWhenLive` (boolean, default `false`) — начислять coins за Twitch reward только когда стрим онлайн
  - `submissionRewardCoins`
  - `submissionRewardOnlyWhenLive` (boolean, default `false`) — начислять coins за approved submission только когда стрим онлайн
  - `coinIconUrl`
  - `primaryColor`, `secondaryColor`, `accentColor`
  - `overlayMode`, `overlayShowSender`, `overlayMaxConcurrent`
  - `createdAt`
  - `owner`: `{ id, displayName, profileImageUrl } | null`
  - `stats`: `{ memesCount, usersCount }`
  - если `includeMemes=true`:
    - `memes`: array `{ id,title,type,fileUrl,durationMs,priceCoins,createdAt }`
    - `memesPage`: `{ limit, offset, returned, total }`

### GET `/channels/:slug/memes`
- **Auth**:
  - prod: public
  - beta: `authenticate + requireBetaAccess`
- **Query**: `limit` (default 30), `offset` (default 0)
- **Response**: array мемов (approved) с `createdBy`:
  - `{ id, channelId, title, type, fileUrl, durationMs, priceCoins, status, createdAt, createdBy: { id, displayName } }`

### GET `/channels/:slug/wallet`
- **Auth**: `authenticate + requireBetaAccess`
- **Response**: wallet (upsert, если не было — создаст)
  - `{ id, userId, channelId, balance, updatedAt }`

### GET `/me`
- **Auth**: `authenticate + requireBetaAccess`
- **Response**:
  - `{ id, displayName, profileImageUrl, role, channelId, channel, wallets, externalAccounts }`
  - `channel`: `{ id, slug, name } | null`
  - `wallets`: array wallet rows
  - `externalAccounts`: array привязанных аккаунтов (см. `/auth/accounts`)

### GET `/me/preferences`
- **Auth**: `authenticate + requireBetaAccess`
- **Response**:
  - `{ theme, autoplayMemesEnabled, memeModalMuted, coinsInfoSeen }`
  - `theme`: `"light" | "dark"`
- **Поведение**:
  - если записи в БД ещё нет — вернёт дефолты:
    - `theme="light"`
    - `autoplayMemesEnabled=true`
    - `memeModalMuted=false`
    - `coinsInfoSeen=false`

### PATCH `/me/preferences`
- **Auth**: `authenticate + requireBetaAccess`
- **Body (JSON)**: partial object (любое подмножество полей)
  - `{ theme?, autoplayMemesEnabled?, memeModalMuted?, coinsInfoSeen? }`
- **Response**:
  - **полный** object preferences (уже слитый/актуальный): `{ theme, autoplayMemesEnabled, memeModalMuted, coinsInfoSeen }`

### GET `/wallet`
- **Auth**: `authenticate + requireBetaAccess`
- **Query**: `channelId` (обязательно)
- **Response**:
  - wallet row `{ id, userId, channelId, balance, updatedAt }`
  - если wallet не найден — вернёт объект с `balance: 0` и `id: ""`

### GET `/memes`
- **Auth**: `authenticate + requireBetaAccess`
- **Query**:
  - `channelSlug` **или** `channelId` (если не передать — 400)
  - `limit`, `offset` (опционально)
- **Response**: array мемов (approved, `deletedAt=null`) с `createdBy`:
  - `{ id, channelId, title, type, fileUrl, durationMs, priceCoins, status, createdAt, createdBy: { id, displayName } }`

### GET `/channels/memes/search`
- **Auth**:
  - prod: public, **optional auth** (для `favorites=1`)
  - beta: `authenticate + requireBetaAccess`
- **Query**:
  - `q` — поиск по title/tags (+ uploader если `includeUploader=1`)
  - `tags` — строка `tag1,tag2` (имена тегов)
  - `channelId` или `channelSlug` (фильтр)
  - `minPrice`, `maxPrice`
  - `sortBy`: `createdAt | priceCoins | popularity`
  - `sortOrder`: `asc | desc`
  - `includeUploader=1` (для dashboard-поиска по uploader)
  - `favorites=1` (возвращает “любимое” пользователя — требует auth и channelId/slug)
  - `limit` (дефолт 50, зажат env), `offset`
- **Response**: array мемов (approved) с:
  - `createdBy`, `tags: [{ tag: { id, name } }]`
  - `_count.activations` (для popularity)

### GET `/memes/stats`
- **Auth**:
  - prod: public, optional auth (auth исключает “self” из статистики)
  - beta: `authenticate + requireBetaAccess`
- **Query**:
  - `period`: `day | week | month | year | all` (default `month`)
  - `limit` (default 10)
  - `channelId` или `channelSlug` (опционально)
- **Response**:
  - `{ period, startDate, endDate, stats }`
  - `stats`: array `{ meme: { id, title, priceCoins, tags } | null, activationsCount, totalCoinsSpent }`
  - иногда есть `rollup` (какая таблица использована)

### POST `/memes/:id/activate`
- **Auth**: `authenticate + requireBetaAccess`
- **Body**: нет (id берётся из URL)
- **Response**:
  - `{ activation, wallet, originalPrice, finalPrice, discountApplied, isFree }`
  - `activation`: `{ id, channelId, userId, memeId, coinsSpent, status: "queued", createdAt }`
  - `wallet`: `{ id, userId, channelId, balance, updatedAt }`
- **Realtime side-effects**:
  - в `channel:{slugLower}`: `activation:new { id, memeId, type, fileUrl, durationMs, title, senderDisplayName }`
  - в `user:{userId}`: `wallet:updated { userId, channelId, balance, delta, reason, channelSlug }` (если были списания)

## Auth (OAuth + account linking)

### GET `/auth/:provider`
- **Auth**: нет
- **Query**:
  - `redirect_to` — куда на фронте вернуть после логина (например `/dashboard`)
- **Response**: редирект на OAuth провайдера
- **Поддерживаемые provider (login)**: `twitch`  
  Остальные провайдеры сейчас поддерживаются **только** в режиме привязки аккаунта (`/auth/:provider/link`).
- **Важно**:
  - при первом логине пользователь создаётся как `role="viewer"` **без автосоздания Channel** (канал появляется только когда юзер станет стримером отдельным действием).

### GET `/auth/:provider/callback`
- **Auth**: нет
- **Response**: редирект на фронт + ставит cookie `token` или `token_beta`

### GET `/auth/twitch/complete`
- **Назначение**: обмен временного токена при “prod callback → beta frontend”
- **Query**: `token`, `state`
- **Response**: редирект на фронт + ставит cookie `token_beta`

### GET `/auth/:provider/link`
- **Auth**: `authenticate + requireBetaAccess`
- **Query**:
  - `redirect_to` (optional, default `/settings/accounts`)
- **redirect_to security**:
  - допускаются только **относительные** пути вида `/settings/accounts`
  - внешние URL (`https://evil.com`, `//evil.com`) будут заменены на безопасный дефолт
- **Response**: редирект на OAuth провайдера для привязки аккаунта к текущему `User`
- **Поддерживаемые provider (link)**:
  - `twitch` (полный OAuth)
  - `youtube` (полный OAuth через Google OpenID userinfo)
  - `vk` (полный OAuth)
  - `vkvideo` (полный OAuth VK Video Live, см. `https://dev.live.vkvideo.ru/docs/main/authorization`)
  - `kick | trovo | boosty` — пока **заглушка**: вернёт редирект обратно на `redirect_to` с `?error=auth_failed&reason=provider_not_supported&provider=<provider>`
- **Если пользователь не залогинен**: редирект на фронт с `/?error=auth_required&reason=no_session`
- **Если вместо редиректа видите `401 Unauthorized`**:
  - Фронт отправил запрос **без cookies** → убедиться, что запрос сделан с `credentials: 'include'` (и в fetch/axios включены credentials).
  - Cookies не дошли из-за CORS → backend должен отвечать `Access-Control-Allow-Credentials: true` и `Access-Control-Allow-Origin` конкретным origin (не `*`).
  - Cookie выставлена на другой домен/поддомен (Domain mismatch) → `token_beta` должна быть доступна для домена API, куда реально идёт запрос.
  - В логах backend на 401 теперь есть событие `auth.no_token_cookie` (видно `host/origin` и список ключей cookies, без значений).

### GET `/auth/:provider/link/callback`
- **Auth**: нет (OAuth callback)
- **Response**: редирект на фронт (cookie не меняет)  
  Если аккаунт уже привязан к другому пользователю: редирект с `?error=auth_failed&reason=account_already_linked`

### GET `/auth/accounts`
- **Auth**: `authenticate + requireBetaAccess`
- **Response**:
  - `{ accounts: ExternalAccount[] }`

### DELETE `/auth/accounts/:externalAccountId`
- **Auth**: `authenticate + requireBetaAccess`
- **CSRF**: да (как и для любых `DELETE` в production)
- **Response**: `{ ok: true }`
- **Ошибки**:
  - `400` если это последний привязанный аккаунт (нельзя отвязать последний)
  - `404` если аккаунт не найден или не принадлежит текущему пользователю

### POST `/auth/logout`
- **Auth**: нет (можно без cookie)
- **Response**: `{ "message": "Logged out successfully" }`  
  Очищает **оба** cookie: `token` и `token_beta` (с несколькими вариантами domain).

### (Legacy) Twitch-only aliases
- `GET /auth/twitch` — legacy entrypoint (эквивалент `GET /auth/:provider` при `provider=twitch`)
- `GET /auth/twitch/callback` — legacy callback (эквивалент `GET /auth/:provider/callback` при `provider=twitch`)

## Submissions (загрузка/импорт/ресабмит)

Все `/submissions/*` требуют: **`authenticate + requireBetaAccess`**

### POST `/submissions`
- **Content-Type**: `multipart/form-data`
- **Form fields**:
  - `file` (обязательно): video
  - `title` (string, 1..200)
  - `type`: строго `"video"`
  - `notes` (string до 500, optional)
  - `tags` (optional): **JSON-string** массива строк (например `["cat","lol"]`)
  - `durationMs` (optional): число, fallback если сервер не смог определить длительность
  - `channelId` (optional): если не передать — берётся `req.channelId` из JWT
- **Response (2 варианта)**:
  - если отправляет владелец канала (`streamer/admin` и `req.channelId === channelId`): вернёт **Meme** (approved) + `isDirectApproval: true`
  - иначе: вернёт **MemeSubmission** (status `pending`)

### POST `/submissions/import`
- **Body (JSON)**:
  - `{ title, sourceUrl, notes?, tags? }` (см. `importMemeSchema`)
  - `sourceUrl` должен быть `memalerts.com` или `cdns.memealerts.com`
  - `channelId` можно передать в body/query (иначе из JWT)
- **Response**: `MemeSubmission` (status `pending`, `sourceUrl` заполнен)

### GET `/submissions` и GET `/submissions/mine`
- **Response**: array сабмишенов пользователя:
  - `{ id, channelId, submitterUserId, title, type, fileUrlTemp, sourceUrl, notes, status, moderatorNotes, revision, createdAt, tags }`
  - `tags`: array `{ tag: { id, name } }`

### POST `/submissions/:id/resubmit`
- **Body (JSON)**: `{ title, notes?, tags? }`
- **Условия**:
  - текущий статус сабмишена должен быть `needs_changes`
  - лимит попыток: env `SUBMISSION_MAX_RESUBMITS` (default 2)
- **Response**: обновлённый сабмишен (status снова `pending`, `revision++`)

## Streamer panel (`/streamer/*`)

Требует: `authenticate + requireBetaAccess` + роль **`streamer|admin`**

### GET `/streamer/submissions`
- **Query**:
  - `status` (optional)
  - `limit`, `offset` (optional)
  - `includeTotal=1` (optional, вернёт total)
  - `includeTags=0` чтобы ускорить список (по умолчанию tags включены)
- **Response**:
  - back-compat: если нет paging — array
  - если есть paging: `{ items, total }`
  - `items` поля: `id, channelId, submitterUserId, title, type, fileUrlTemp, sourceUrl, notes, status, moderatorNotes, revision, createdAt, submitter{ id, displayName }, tags?`

### POST `/streamer/submissions/:id/approve`
- **Body (JSON)** (см. `approveSubmissionSchema`):
  - `priceCoins?` (default 100 / или channel.defaultPriceCoins)
  - `durationMs?` (default 15000; сервер пытается прочитать реальную длительность)
  - `tags?` (array string)
- **Response**: созданный **Meme** (approved)
- **Realtime side-effects**:
  - `submission:approved` в `channel:{slugLower}`
  - возможно `wallet:updated` submitter’у (если `submissionRewardCoins > 0`)

### POST `/streamer/submissions/:id/reject`
- **Body (JSON)**: `{ moderatorNotes? }`
- **Response**: обновлённый сабмишен (status `rejected`)
- **Realtime**: `submission:rejected`

### POST `/streamer/submissions/:id/needs-changes`
- **Body (JSON)**: `{ moderatorNotes }` (required)
- **Response**: обновлённый сабмишен (status `needs_changes`)
- **Realtime**: `submission:needs_changes` (в channel room + в `user:{submitterId}`)

### GET `/streamer/memes`
- **Query**:
  - `q` (search by title)
  - `status`: `pending|approved|rejected|deleted|all` (default: “not deleted”)
  - `limit`, `offset` (если `all!=1`)
  - `sortOrder=asc|desc`
  - `includeTotal=1` (через header `X-Total-Count`)
  - `all=1` — legacy (без лимита; не рекомендовано)
- **Response**: array мемов (в ответе заголовки paging: `X-Limit`, `X-Offset`, `X-Has-More`, `X-Total-Count?`)

### PATCH `/streamer/memes/:id`
- **Body (JSON)**: `{ title?, priceCoins?, durationMs? }`
- **Response**: обновлённый meme (с `createdBy`, `approvedBy`)

### DELETE `/streamer/memes/:id`
- **Response**: soft-deleted meme (`status: "deleted"`, `deletedAt`)

### PATCH `/streamer/channel/settings`
- **Body (JSON)**: см. `updateChannelSettingsSchema` (reward + флаги live-only + цвета + overlay + `submissionRewardCoins`)
- **Пример body**:
  - `{ "rewardOnlyWhenLive": true, "submissionRewardOnlyWhenLive": false }`
- **Response**: обновлённая запись Channel (много полей; фронту важны поля из schema)
- **Realtime**: `overlay:config` в `channel:{slugLower}` (чтобы OBS не перезагружать)
- **Twitch-only guard**:
  - если `Channel.twitchChannelId == null`, то попытка включить/обновлять Twitch reward вернёт `400`:
    - `{ errorCode: "TWITCH_CHANNEL_NOT_LINKED" }`

### GET `/streamer/twitch/reward/eligibility`
- **Response**:
  - `{ eligible: true|false|null, broadcasterType, checkedBroadcasterId, reason? }`
  - на beta может добавлять `debug`

### Promotions
- **GET `/streamer/promotions`** → array promotions (или `[]` если таблицы нет/timeout)
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
  - лимиты:
    - `presets.length <= 30`
    - общий JSON size ограничен (413 если слишком большой)
  - preset shape (пример):
    - `{ id: "p_...", name: "My preset", createdAt: 173..., payload: { v:1, overlayMode:"queue", overlayShowSender:true, overlayMaxConcurrent:3, style:{...} } }`

### OBS Credits Overlay
- **GET `/streamer/credits/token`** → `{ token, creditsStyleJson }`
- **POST `/streamer/credits/settings`** body: `{ creditsStyleJson: string }` (можно пустую строку → очистка) → `{ ok, creditsStyleJson }`
- **POST `/streamer/credits/token/rotate`** → `{ token }`
- **POST `/streamer/credits/reset`** → `{ ok: true }`
- **POST `/streamer/credits/reconnect-window`** body: `{ minutes }` → `{ creditsReconnectWindowMinutes }`

### Chat bot (панель стримера)
- **Док для разработчиков про запуск/ENV/диагностику ботов**: `docs/BOTS.md`
- **POST `/streamer/bot/enable`** → `{ ok: true }`
- **POST `/streamer/bot/disable`** → `{ ok: true }`
- **POST `/streamer/bot/say`** body:
  - `{ message }` → отправляет в **Twitch** (если Twitch bot включён для канала)
  - `{ provider: "youtube", message }` → отправляет в **YouTube** (если YouTube bot включён для канала)
  - `{ provider: "vkvideo", message }` → отправляет в **VKVideo** (если VKVideo bot включён для канала)
  - response: `{ ok, outbox: { id, status, createdAt } }`
- **Twitch-only guard**:
  - если `Channel.twitchChannelId == null`, то `enable/disable` и follow-greetings enable вернут `400`:
    - `{ error: "Bad Request", message: "This channel is not linked to Twitch" }`
- **GET `/streamer/bot/commands`** → `{ items: [{ id, trigger, response, enabled, onlyWhenLive, allowedRoles, allowedUsers, createdAt, updatedAt }] }`
- **POST `/streamer/bot/commands`**
  - body `{ trigger, response, onlyWhenLive?, allowedRoles?, allowedUsers? }` → `201` command row; `409` если trigger уже есть
  - `onlyWhenLive` (optional, default `false`) — если `true`, бот отвечает на команду **только когда стрим онлайн**
  - `allowedRoles` (optional) — массив ролей: `["vip","moderator","subscriber","follower"]`
  - `allowedUsers` (optional) — массив логинов Twitch (lowercase, без `@`), max 100 (валидируется regex `^[a-z0-9_]{1,25}$`)
  - **правило по умолчанию**: если `allowedRoles=[]` и `allowedUsers=[]` → команду может триггерить любой
  - ⚠️ роль `follower` из IRC tags Twitch не определяется (нужна отдельная проверка через Helix + кеш); пока реально работает только whitelist по `allowedUsers` и роли `vip/moderator/subscriber`
- **PATCH `/streamer/bot/commands/:id`**
  - body `{ enabled?, onlyWhenLive?, allowedRoles?, allowedUsers? }` → updated command row
  - body — partial object; нужно передать **хотя бы одно** поле (любое из 4)
- **DELETE `/streamer/bot/commands/:id`** → `{ ok: true }`
- **GET `/streamer/bot/subscription`** → `{ enabled }` (если подписки нет — `enabled: false`)

### Bot integrations (панель стримера)
- **GET `/streamer/bots`** → `{ items: [{ provider: "twitch"|"vkplaylive"|"vkvideo"|"youtube", enabled, updatedAt }] }`
- **PATCH `/streamer/bots/:provider`** → `{ ok: true }`
  - body для всех провайдеров: `{ enabled: boolean }`
  - **дополнительно для `provider="vkvideo"` при `enabled=true`** нужно передать `vkvideoChannelId`:
    - body: `{ enabled: true, vkvideoChannelId: string }`
    - или можно включить без `vkvideoChannelId`: `{ enabled: true }` — backend попробует определить канал автоматически через VKVideo `GET /v1/current_user` (нужна линковка VKVideo аккаунта). Если каналов несколько — нужно передать `vkvideoChannelId` явно.
  - **Важно (про раннеры)**: включение через этот эндпоинт меняет состояние в БД, но **сообщения/команды начнут работать только если запущен соответствующий воркер** (см. `docs/BOTS.md`).
  - **Twitch-only guard**: при `provider="twitch"` и `Channel.twitchChannelId == null` вернёт `400` как и `/streamer/bot/enable`.
  - ⚠️ если фича ещё не задеплоена/не применены миграции — backend может вернуть `404` (фронт должен показать “недоступно”).
- **GET `/streamer/bot/follow-greetings`** → `{ followGreetingsEnabled, followGreetingTemplate }`
- **POST `/streamer/bot/follow-greetings/enable`** body optional `{ followGreetingTemplate }` → `{ ok, followGreetingsEnabled, followGreetingTemplate }`
- **POST `/streamer/bot/follow-greetings/disable`** → `{ ok, followGreetingsEnabled, followGreetingTemplate }`
- **PATCH `/streamer/bot/follow-greetings`** body `{ followGreetingTemplate }` → `{ ok, followGreetingsEnabled, followGreetingTemplate }`
- **GET `/streamer/bot/stream-duration`** → `{ enabled, trigger, responseTemplate, breakCreditMinutes, onlyWhenLive }`
- **PATCH `/streamer/bot/stream-duration`** body `{ enabled, trigger, responseTemplate, breakCreditMinutes, onlyWhenLive }` → те же поля

#### “Умная” команда бота: время стрима
- **Назначение**: бот отвечает на команду (например `!time`) “время стрима” — **сумма онлайна** за текущую сессию.
- **Кредит паузы**: оффлайн пауза **<= `breakCreditMinutes`** не разрывает сессию; если **> `breakCreditMinutes`** — считается новым стримом (таймер “сбрасывается”).
- **responseTemplate**: строка (или `null`) с плейсхолдерами:
  - `{hours}` — часы (целое)
  - `{minutes}` — минуты (остаток 0..59)
  - `{totalMinutes}` — всего минут (целое)
- **onlyWhenLive**: если `true` — бот отвечает только когда стрим онлайн (если стрим оффлайн — бот **молчит**).
- **Дефолты** (если настройки ещё не сохранены):
  - `enabled=false`
  - `trigger="!time"`
  - `responseTemplate="Время стрима: {hours}ч {minutes}м ({totalMinutes}м)"`
  - `breakCreditMinutes=60`
  - `onlyWhenLive=false`
- **Важно**: если фича ещё не задеплоена/не применены миграции — backend может вернуть `404` (фронт должен показать “недоступно”).

## Owner panel (`/owner/*`) — admin only

Требует: `authenticate + requireBetaAccess` + роль **admin**

### GET `/owner/wallets/options`
- **Response**: `{ users, channels }` (для dropdown’ов)
  - `users`: `{ id, displayName, twitchUserId }[]`
  - `channels`: `{ id, name, slug }[]`

### GET `/owner/wallets`
- **Query (фильтры/paging)**:
  - `userId`, `channelId`, `q` (по user/channel)
  - `limit`, `offset`
  - `includeTotal=1`
- **Response**:
  - back-compat: array (если без фильтров)
  - иначе: `{ items, total }`, где `items`:
    - `{ id, userId, channelId, balance, updatedAt, user, channel }`

### POST `/owner/wallets/:userId/:channelId/adjust`
- **Body (JSON)**: `{ amount: number }` (может быть + или -; итоговый баланс не может стать < 0)
- **Response**: обновлённый wallet (с `user`, `channel`)

## Beta access (`/beta/*` и `/owner/beta/*`)

### POST `/beta/request`
- **Auth**: `authenticate`
- **Response**: `{ message, request }` (создаёт/обновляет BetaAccess)

### GET `/beta/status`
- **Auth**: `authenticate`
- **Response**: `{ hasAccess: boolean, request: { id,status,requestedAt,approvedAt } | null }`

### Admin beta management (все: `authenticate + role=admin`)
- **GET `/owner/beta/requests`** → array заявок (pending/approved/rejected)
- **POST `/owner/beta/requests/:id/approve`** → `{ message, request }` (и `user.hasBetaAccess=true`)
- **POST `/owner/beta/requests/:id/reject`** → `{ message, request }`
- **GET `/owner/beta/users`** → array пользователей с доступом + `betaAccess`
- **GET `/owner/beta/users/revoked`** → array revoked
- **POST `/owner/beta/users/:userId/revoke`** → `{ message, userId }`
- **POST `/owner/beta/users/:userId/restore`** → `{ message, userId }`

## Webhooks / Internal (не для фронта)

- **POST `/webhooks/twitch/eventsub`** — Twitch EventSub (HMAC), фронту не нужен.
- **`/internal/*`** — localhost-only relay между prod/beta и credits events, фронту не нужен.

## Socket.IO (Realtime)

### Подключение
- Клиент подключается к Socket.IO на том же origin backend, `withCredentials`/cookies — для dashboard join’ов.

### Rooms (имена)
- `channel:{slugLower}` — overlay + стримерская панель для 1 канала
- `user:{userId}` — персональные события пользователя (кошелёк, сабмишены)

### Client → Server события

- **`join:overlay`** `{ token }`
  - token получают по HTTP:
    - meme overlay: `GET /streamer/overlay/token`
    - credits overlay: `GET /streamer/credits/token`
- **`join:channel`** `(channelSlug)`
  - только authenticated `streamer/admin`, и slug обязан совпасть с каналом пользователя
- **`join:user`** `(userId)`
  - разрешено только если `userId === auth.userId`
- **`activation:ackDone`** `{ activationId }`
  - помечает activation `status=done`

### Server → Client события

- **Overlay**:
  - `overlay:config` → `{ overlayMode, overlayShowSender, overlayMaxConcurrent, overlayStyleJson }`
  - `activation:new` → `{ id, memeId, type, fileUrl, durationMs, title, senderDisplayName }`
- **Wallet**:
  - `wallet:updated` → `{ userId, channelId, balance, delta?, reason?, channelSlug?, source? }` (**только** `user:{id}`)
- **Submissions** (в `channel:{slugLower}` и опционально в `user:{id}`):
  - `submission:created|approved|rejected|needs_changes|resubmitted`
  - payload: `{ submissionId, channelId, submitterId?, moderatorId? }`
- **Credits overlay**:
  - `credits:config` → `{ creditsStyleJson }`
  - `credits:state` → `{ chatters: [{name}], donors: [{name,amount,currency}] }`


