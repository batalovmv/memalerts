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

## CI (self-hosted runner)

Tests run in the self-hosted workflow: `.github/workflows/ci-cd-selfhosted.yml`.

- The `test` job starts Postgres as a service (port **5433**) and sets:
  - `NODE_ENV=test`
  - `TEST_DATABASE_URL_BASE=postgresql://postgres:postgres@localhost:5433/memalerts_test`
- Then it runs `pnpm test:ci` (which is `vitest run`).

Beta/prod deployment in this workflow depends on tests passing successfully.


