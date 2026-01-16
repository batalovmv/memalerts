# Database Migrations

This repo uses a shared beta/prod database in some environments, so migrations must be backward compatible and safe to roll out while older code may still be running.

## Core principles

- Prefer expand/contract: add first, backfill, then remove later.
- Avoid breaking changes in a single deploy (type changes, renames, drops).
- Keep data changes batched and bounded (no full-table updates without a WHERE).

## Migration lint (CI warning)

`pnpm migrations:check` scans only new/changed migration SQL files and emits warnings in CI.

### Rules (and IDs)

- `drop-table`, `drop-column`: DROP without a feature flag annotation.
- `not-null-no-default`: NOT NULL on existing tables without a DEFAULT.
- `no-where`: UPDATE/DELETE without WHERE (full-table scan).
- `alter-column-type`: ALTER COLUMN ... TYPE
- `rename-column`: RENAME COLUMN
- `rename-table`: RENAME TABLE

### Feature flag annotation

For destructive drops, add a comment near the statement:

```sql
-- feature-flag: MY_FLAG_NAME
ALTER TABLE "Example" DROP COLUMN "oldField";
```

### Suppress a specific warning

If a rule is a false positive, annotate the statement:

```sql
-- memalerts-lint: allow no-where
UPDATE "SomeTable" SET "flag" = true;
```

You can also list multiple rule IDs:

```sql
-- memalerts-lint: allow drop-table,rename-table
```

Global bypass (local/manual only):

```
ALLOW_DESTRUCTIVE_MIGRATIONS=1 pnpm migrations:check
```

## Safer patterns

- New NOT NULL column:
  1) `ADD COLUMN ... NULL`
  2) Backfill in batches (WHERE + LIMIT) or via application code.
  3) `ALTER COLUMN ... SET DEFAULT`
  4) `ALTER COLUMN ... SET NOT NULL` in a later migration.
- Renames/type changes:
  - Add new column, dual-write, backfill, cut over reads, drop later.
- Large updates:
  - Use WHERE with a stable predicate and batch by id/time.
  - Prefer `CREATE INDEX CONCURRENTLY` for big tables (Postgres).
