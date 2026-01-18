# DB Connection Pooling Audit

Date: 2026-01-18

Scope: Postgres connections via Prisma (`DATABASE_URL`).

## Current behavior

- Prisma manages its own connection pool per process.
- The pool size is controlled by the `connection_limit` parameter in the Postgres connection string.
- Each PM2 instance creates its own pool, so total connections scale with instance count.

## Recommendations

- Set an explicit `connection_limit` in `DATABASE_URL` to avoid exhausting the DB:
  - Example: `postgresql://user:pass@host:5432/db?connection_limit=10`
- Keep total connections under the DB max:
  - `connection_limit * instance_count + admin_reserved < max_connections`
- For higher scale, consider PgBouncer in transaction pooling mode.

## Follow-ups

- Revisit `connection_limit` after adding more PM2 instances or read replicas.
