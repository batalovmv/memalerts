# Performance Critical Paths

Inventory of user-facing screens and backend endpoints that can turn into latency or scalability bottlenecks as data volume grows. Each entry lists the UI scope, HTTP surface, filters/sorts, expected growth, and any immediate red flags observed during this pass.

## StreamerModerationPage
- Endpoint: `GET /streamer/submissions?status=pending&cursor=<opaque>&limit=50`
- Filters: `channelId = current streamer channel`, optional `status` + `includeTags`
- Sort: `createdAt desc, id desc`
- Volume: 10k–50k pending rows long term per high-volume channel
- Notes: composite indexes `(channelId, status, createdAt desc)` now exist alongside cursor pagination to eliminate seq scans; keep selects lean (title/status/preview + submitter, tags opt-in).

## ViewerMySubmissions
- Endpoint: `GET /submissions/mine?status=<optional>&cursor=<opaque>&limit=50`
- Filters: `submitterUserId = viewer`, optional `status`
- Sort: `createdAt desc, id desc`
- Volume: 5k+ rows per power user over time
- Notes: cursor pagination + indexes `(submitterUserId, status, createdAt desc)` & `(submitterUserId, createdAt desc)` cover both filtered and unfiltered queries; keep payload slim (display metadata only).

## ChannelMemeLibrary
- Endpoint: `GET /channels/:slug/memes?cursor=<opaque>&limit=50`
- Filters: `channelId` via slug, `status = approved`, `deletedAt is null`; optional `sortBy=createdAt|priceCoins`
- Sort: default `createdAt desc, id desc`, or `priceCoins asc/desc` with tie-breaker
- Volume: 20k approved memes per mature streamer + pool overlays
- Notes: requires `(channelId, status, createdAt desc, id desc)` index and, for price sorting, `(channelId, status, priceCoins, id)`; pagination must work across both channel-owned and pool-all catalog modes.

## OverlayQueueFetch
- Endpoint: `GET /streamer/overlay/preview-memes?count<=5&seed=...`
- Filters: prioritizes `channelId`, then creator, then global
- Sort: deterministic pseudo-random via `md5(id || seed)`
- Volume: Many small bursts when dashboards open; ensures limit≤5 already, but requires caching for backing `/uploads/*` assets to prevent redundant downloads.
- Notes: confirm pool queries limit I/O; `/uploads/*` now served with `Cache-Control: public, max-age=31536000, immutable` + `X-Content-Type-Options`; consider caching overlay preset GETs with `Cache-Control: private, max-age=30`.

## PublicChannelMemes
- Endpoints: `GET /public/channels/:slug/memes?cursor=<opaque>&limit=50`, `GET /public/channels/:slug/memes/search?q&cursor=<opaque>&limit=50`
- Filters: channel slug → `channelId`, `status=approved`, `deletedAt is null`; search uses `title|searchText|createdBy`
- Sort: `createdAt desc` (default) or `priceCoins asc/desc` (channel mode); cursor built on `(createdAt, id)` or `(priceCoins, createdAt, id)`
- Volume: Externally cacheable, but can spike (50 RPS target) when public catalog is embedded or automated scrapers hit the endpoint
- Notes: Offset pagination remains for legacy clients, but `cursor=` opt-in now returns `{ items, nextCursor, total }`; perf seed (`pnpm seed:perf`) preloads 10k channel memes + 20k submissions for load tests; load profiles live in `tests/load/*.k6.js` (`pnpm test:load` heavy run, `pnpm test:load:smoke` CI-safe).

## BotsOutboxPolling
- Endpoint: `GET /streamer/bot/outbox/:provider/:id` + runners hitting DB (`ChatBotOutboxMessage`, provider-specific tables)
- Filters: `status in ('pending','processing')`, `channelId` or provider keys
- Sort: `createdAt asc` for FIFO
- Volume: 10k pending rows during spikes per provider
- Notes: add `(status, createdAt)` + provider/channel scoped composite indexes; enforce `LIMIT 100` pulls in runners; avoid `SELECT *` (only message payload + routing fields).

## WalletSnapshotAndRealtime
- Endpoints: `GET /wallet`, `GET /viewer/:slug/wallet`, socket `wallet:updated`
- Filters: `userId` or `channelId`
- Sort: none (single row fetch) but joins across balances + pending grants
- Volume: called on every dashboard load; needs read replica or caching if it grows
- Notes: keep SQL covered by indexes on `Wallet(userId, channelId)` and ensure realtime bridge emits only to `user:{id}`; consider short-term cache headers for viewer wallet GET (private, max-age=15).

## Load Tests
- Heavy profile: `pnpm test:load` (k6 scenarios: moderation 20 RPS, my submissions 20 RPS, public channel memes 50 RPS).
- Smoke profile: `pnpm test:load:smoke` (5 VUs / 10s, asserts no 5xx and p95 < 500ms).
- Env knobs: `BASE_URL` (default `http://localhost:3001`), `STREAMER_COOKIE`, `VIEWER_COOKIE`, `PUBLIC_CHANNEL_SLUG` (default `perf_test_channel`).
- Always run `pnpm seed:perf` first to guarantee 20k submissions + 10k channel memes backing the tests.
- Rolling restart smoke (local): `powershell -ExecutionPolicy Bypass -File tools/rolling-restart-smoke.ps1` (starts two app instances + health-aware proxy, emits SIGTERM on instance A, runs k6 smoke against the proxy).
- Rolling restart flags: `-SkipSeed`, `-AppPortA`, `-AppPortB`, `-ProxyPort`, `-SigtermAfterMs` (see `tools/rolling-restart-smoke.ps1`).

## Verification Queries
- Streamer moderation:  
  `EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM "MemeSubmission" WHERE "channelId" = '<perf_channel_id>' AND "status" = 'pending' ORDER BY "createdAt" DESC, "id" DESC LIMIT 51;`
- Viewer submissions:  
  `EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM "MemeSubmission" WHERE "submitterUserId" = '<perf_user_id>' ORDER BY "createdAt" DESC, "id" DESC LIMIT 51;`
- Expect `Index Scan` or `Bitmap Index Scan` hitting the new composites; re-run after `pnpm seed:perf` to refresh planner stats.
