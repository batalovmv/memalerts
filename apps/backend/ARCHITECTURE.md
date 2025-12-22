# MemAlerts Backend — Architecture

This document describes the **current backend architecture** and how the major parts interact.  
Repo: `memalerts-backend` (Express + Socket.IO + Prisma/Postgres).

## Goals & principles

- **Backward compatibility**: existing routes/clients must keep working.
- **Security-first**: treat all inputs as untrusted; validate strictly; least-privilege.
- **Scalable structure**: small files, clear boundaries, fast search/navigation.
- **Real-time correctness**: keep public vs private events separated; minimize payloads.

## High-level components

- **HTTP API (Express)**: REST endpoints for auth, viewer, streamer/owner panel.
- **Realtime (Socket.IO)**: overlay + client updates (activations, wallet updates, etc).
- **Database (Postgres via Prisma)**: source of truth for users, channels, memes, wallets, submissions, activations, audit logs.
- **Uploads**: local `uploads/` storage; files are deduplicated by hash where applicable.
- **Twitch integration**:
  - OAuth login
  - Channel Points rewards management (create/update/disable)
  - EventSub webhooks (verified; replay-protected)

## Routing & access model

### Route groups

- **Public / semi-public**
  - `GET /health`
  - `GET /channels/:slug`
  - `GET /channels/:slug/memes`
  - `GET /channels/memes/search`
  - `GET /memes/stats`

- **Authenticated viewer**
  - `GET /me`
  - `GET /channels/:slug/wallet`
  - `POST /memes/:id/activate`

- **Streamer panel**
  - Mounted under `/streamer/*`
  - Role: `streamer` or `admin`

- **Owner-only**
  - Mounted under `/owner/*`
  - Role: `admin`

> **Important:** `/admin/*` is a **legacy alias** router for backward compatibility.  
> Do not infer permissions from path names—permissions are enforced by middleware.

### Key middleware

- `auth.ts`: JWT auth (httpOnly cookies) → sets `req.userId`, `req.channelId`, `req.userRole`
- `betaAccess.ts`: gates beta domain access (requires user-specific beta permission)
- `csrf.ts`: protects state-changing endpoints (Origin/Referer rules)
- `rateLimit.ts`: global + endpoint-specific limiters
- `upload.ts`: upload handling + security logging

## Controller layout (search-friendly)

Controllers are now organized by feature, while keeping **facade exports** for compatibility.

### Admin/Streamer controllers

- Facade: `src/controllers/adminController.ts`
- Modules: `src/controllers/admin/*`
  - `twitch.ts` — eligibility checks
  - `overlay.ts` — OBS overlay token/rotation/preview
  - `submissions.ts` — moderation (list/approve/reject)
  - `memes.ts` — streamer meme management
  - `channelSettings.ts` — reward + overlay + theme settings
  - `wallet.ts` — owner-only wallet admin
  - `promotions.ts` — promotions CRUD
  - `stats.ts` — channel stats + caching/ETag

### Viewer controllers

- Facade: `src/controllers/viewerController.ts`
- Modules: `src/controllers/viewer/*`
  - `cache.ts` — shared cache/ETag helpers
  - `channel.ts` — public channel/meta + public memes list
  - `me.ts` — user profile endpoint
  - `wallet.ts` — wallet endpoints
  - `memes.ts` — authed memes list
  - `search.ts` — meme search + caching
  - `stats.ts` — public stats + caching
  - `activation.ts` — activation flow + wallet updates + overlay emit

### Submissions (upload/import)

- Facade: `src/controllers/submissionController.ts`
- Modules: `src/controllers/submission/*`
  - `createSubmission.ts` — file upload validation + dedup + (owner direct-approve) + submit event
  - `getMySubmissions.ts` — list own submissions (timeout-protected)
  - `importMeme.ts` — server-side download + validation + submission creation

## Key runtime flows

### 1) Meme activation (viewer → overlay)

1. Viewer calls `POST /memes/:id/activate` (auth + beta access where applicable).
2. Transaction:
   - Validate meme is approved
   - Resolve promotion (optional)
   - Ensure wallet exists
   - Deduct coins (unless channel owner free activation)
   - Create `MemeActivation` with `status=queued`
3. Emit via Socket.IO room `channel:{slugLower}` → `activation:new`
4. Emit wallet update locally + relay to peer backend (prod↔beta mirroring)

### 2) Submission upload (viewer → pending queue / direct approve)

1. `POST /submissions` with uploaded file
2. Server validates:
   - MIME + magic bytes
   - size limit
   - duration (prefer server metadata, fallback to client-provided)
3. Deduplicate file by hash (best-effort)
4. If streamer/admin uploads into own channel → direct create approved meme  
   Otherwise → create `MemeSubmission` pending
5. Emit `submission:created` to streamer via Socket.IO (best-effort)

### 3) Twitch rewards settings

`PATCH /streamer/channel/settings` handles:
- enable/disable reward (with eligibility checks)
- update title/cost/coins (light update if already enabled)
- EventSub subscription management (best-effort; avoid duplicates)

## Deployment & environments

CI/CD is in `.github/workflows/ci-cd.yml`:
- `develop` → deploy beta (`/opt/memalerts-backend-beta`, port 3002)
- `main` → deploy production (`/opt/memalerts-backend`, port 3001)

Deployment uses:
- SCP copy to VPS
- `pnpm install`, `pnpm build`
- `prisma generate`, `prisma migrate deploy`
- PM2 restart
- optional nginx provisioning scripts under `.github/scripts/`


