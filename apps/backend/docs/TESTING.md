## MemAlerts Backend Tests (what exactly we verify)

This project tends to “break” not because of small utilities, but because of **security / routing invariants**. That’s why the tests primarily lock down:

- **beta/prod isolation**: domains/origins, cookie selection (`token` vs `token_beta`), auth behavior on the beta domain.
- **CSRF boundaries**: CSRF is enabled for `POST/PUT/PATCH/DELETE`, but there are strict exceptions:
  - `/internal/*` (internal relay, localhost-only)
  - `/webhooks/*` (Twitch EventSub and other webhooks — HMAC instead of CSRF)
  - `/health`
  - `/auth/twitch*` (backward-compatible auth callback flow)
  - `/public/*`
  - nuance: in production, `POST /auth/logout` is allowed without `Origin` **only if** `Sec-Fetch-Site` = `same-site|same-origin` (see `src/middleware/csrf.ts`).
- **internal relay**: `/internal/*` is accessible only from localhost and requires the `x-memalerts-internal` header.
- **Socket.IO rooms/permissions**: `join:overlay`, `join:channel`, `join:user`, plus a privacy invariant — `wallet:updated` **only** to `user:{id}`.

Most files in `tests/*.test.ts` are named after these invariants (CSRF, internal relay, socket join, beta gating, etc.).

## Quick local test run

Tests **do not use** your regular `DATABASE_URL`. For safety, you must provide a separate base URL:

- `TEST_DATABASE_URL_BASE` — base URL for the test DB (without `?schema=`).

This repo’s default workflow is to run tests in the **CI/self-hosted runner** (and on deploy), where the test Postgres is provisioned and `TEST_DATABASE_URL_BASE` is set by the pipeline.

If you do need to run tests manually, you must point `TEST_DATABASE_URL_BASE` at a **dedicated test database** (not your regular `DATABASE_URL`).

Run tests (example):

```bash
TEST_DATABASE_URL_BASE="postgresql://postgres:postgres@localhost:5433/memalerts_test" pnpm test
```

Watch mode:

```bash
TEST_DATABASE_URL_BASE="postgresql://postgres:postgres@localhost:5433/memalerts_test" pnpm test:watch
```

## VPS test run (prod/beta .env present)

When running tests on a VPS with a production .env, override env to keep tests isolated
and avoid beta gating + S3-specific behavior. Also start the test DB container without
loading .env (docker-compose parses .env and can fail on JSON values).

Start test Postgres:

```bash
docker compose --env-file /dev/null -f docker-compose.test.yml up -d
```

Run the test suite with safe overrides:

```bash
NODE_ENV=test \
DOMAIN=example.com \
PORT=3001 \
INSTANCE=prod \
WEB_URL=https://example.com \
UPLOAD_STORAGE=local \
DEBUG_LOGS=0 \
TEST_DATABASE_URL_BASE="postgresql://postgres:postgres@localhost:5433/memalerts_test" \
pnpm test
```

## How the test DB works

- Tests use **real Postgres**.
- For each run, a **unique schema** is created (`TEST_SCHEMA=test_<uuid>`), then the following is executed:
  - `pnpm prisma db push --accept-data-loss` using the current `prisma/schema.prisma` (see `tests/globalSetup.ts`).
- After the run, the schema is dropped (`DROP SCHEMA ... CASCADE`).

This provides isolation without having to recreate the whole container.

Why `db push` instead of `migrate`:

- The migration history in this repo is **not guaranteed to be “replayable from scratch”** (some migrations assume pre-existing tables), while tests need a deterministic schema built “from the current Prisma schema”.

Useful for debugging:

- **`TEST_SCHEMA`** can be set manually to reuse the same schema across multiple runs.
- `vitest.config.ts` automatically generates `TEST_SCHEMA` and sets `process.env.DATABASE_URL` with `?schema=...`.

## Test factories

To keep tests consistent and reduce boilerplate, use the factories in `tests/factories/` instead of inline
`prisma.*.create` calls.
Avoid direct `prisma.*.create`/`upsert` usage in tests; route new test data through factories instead.

Quick examples:

```ts
import { createChannel, createUser, createSubmission } from './factories/index.js';

const channel = await createChannel({ slug: 'my-channel', name: 'My Channel' });
const user = await createUser({ role: 'viewer', channelId: null });
const submission = await createSubmission({
  channelId: channel.id,
  submitterUserId: user.id,
  title: 'Test',
  status: 'pending',
});
```

Composition helpers are available (e.g. `createUserWithChannel`) and additional factories cover related entities
like file hashes, meme assets, and bot subscriptions.

## Coverage scope

Coverage excludes entrypoints and operational scripts (`scripts/**`, `tools/**`, `prisma/seed.ts`, `src/index.ts`)
plus runtime orchestration modules (`src/jobs/**`, `src/bots/**`). These are validated through integration runs
and production monitoring instead of unit coverage.

## CI (self-hosted runner)

Tests run in the self-hosted workflow: `.github/workflows/ci-cd-selfhosted.yml`.

- The `test` job starts Postgres as a service (port **5433**) and sets:
  - `NODE_ENV=test`
  - `TEST_DATABASE_URL_BASE=postgresql://postgres:postgres@localhost:5433/memalerts_test`
- Then it runs `pnpm test:ci` (which is `vitest run`).

Beta/prod deployment in this workflow depends on tests passing successfully.

## Load tests (k6)

Load tests run against a **dedicated load-test deployment** that uses its own database.
Do not point load tests at production or the regular test database.

Required environment variables (local or CI):

- `BASE_URL` — load-test API base URL.
- `STREAMER_COOKIE` — cookie for a streamer account with moderation access.
- `VIEWER_COOKIE` — cookie for a viewer account.
- `PUBLIC_CHANNEL_SLUG` — public channel slug to exercise catalog endpoints.

Run locally:

```bash
BASE_URL="https://loadtest.example.com" STREAMER_COOKIE="token=..." VIEWER_COOKIE="token=..." pnpm test:load
```

Weekly CI runs in `.github/workflows/load-tests.yml`. It exports a k6 summary to `tests/load/summary.json`
and enforces the baseline regression check in `tests/load/baseline.json` via `pnpm load:regression`.

To refresh the baseline after a stable run:

```bash
k6 run --summary-export=tests/load/summary.json tests/load/main.k6.js
pnpm load:baseline:update
```

## Epic 8 status (Testing Improvements)

- 8.1: factories added and tests migrated off inline Prisma creates.
- 8.2: external service mocks + OAuth callback coverage in place.
- 8.3: bot module tests added; coverage target >60% met.
- 8.4: weekly k6 load tests in CI with per-endpoint thresholds and regression checks.
