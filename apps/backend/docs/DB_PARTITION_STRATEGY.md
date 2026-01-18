# DB Partition Strategy

Target tables for partitioning (time-series growth):
- `MemeActivation`
- `ChatBotOutboxMessage` + provider-specific outbox tables
- `AuditLog`
- `ExternalWebhookDeliveryDedup`

## Goals
- Keep hot partitions small and indexable.
- Enable fast retention deletes via `DROP PARTITION`.
- Reduce VACUUM pressure on large tables.

## Proposed Partitioning
### Range by month on `createdAt`
Recommended for:
- `MemeActivation`
- `AuditLog`
- `ChatBotOutboxMessage` (and provider outbox tables)
- `ExternalWebhookDeliveryDedup`

Example (Postgres):
```sql
CREATE TABLE "MemeActivation" (
  ...,
  "createdAt" timestamptz NOT NULL
) PARTITION BY RANGE ("createdAt");

CREATE TABLE "MemeActivation_2026_01"
  PARTITION OF "MemeActivation"
  FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
```

## Rollout Plan
1) Create partitioned parent + new monthly partitions.
2) Backfill historical partitions (one table at a time).
3) Swap by renaming tables inside a maintenance window.
4) Update retention jobs to drop old partitions.

## Prisma Notes
- Prisma does not manage partitions directly.
- Use raw SQL migrations or `prisma.$executeRawUnsafe` in a one-off script.

## Retention
- `MemeActivation`: keep 12–18 months, roll up stats beyond.
- `AuditLog`: keep 6–12 months or export to cold storage.
- Outbox: keep 7–30 days (already cleaned by scheduler).

## Exit Criteria
- Partitions created for current + next month.
- Old partitions dropped by retention job.
- Query plans hit partition pruning.
