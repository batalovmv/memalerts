# Read Replica Plan

Goal: offload read-heavy endpoints to a replica while preserving write consistency.

## Candidate Endpoints
- Viewer stats (`/viewer/*/stats`)
- Public channel lists (`/public/channels/*`)
- Streamer stats and lists (`/streamer/*` reads)
- Admin read-only endpoints

## Proposed Architecture
- Primary DB: write + critical read-after-write flows.
- Replica DB: read-only, async replication.
- App routing: use `DATABASE_READ_URL` for read-only queries.

## Implementation Steps
1) Provision read replica (Postgres streaming replication).
2) Add `DATABASE_READ_URL` env.
3) Create a read-only Prisma client (separate connection) and use it in read-heavy services.
4) Keep write paths on primary; avoid using replica within transactions.
5) Add health checks for replica lag (if possible).

## Consistency Notes
- Replica lag means eventual consistency.
- For user-facing reads right after write, force primary.
- Use cache headers for public endpoints to reduce load.

## Exit Criteria
- Read traffic reduced on primary by 30%+.
- No read-after-write regressions in production.
