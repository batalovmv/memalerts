# rule-no-stuck

# Anti-stuck rule (PowerShell/SSH/Prisma)

## When you’re stuck

If you are fighting **quoting / shell glue** (PowerShell → `ssh` → `bash`/`psql`, heredocs, `SELECT` being parsed, `&&`, JSON escaping) and you don’t make progress in **2–3 attempts or ~5 minutes**:

- **Stop** trying to “fix the quotes”.
- **Switch strategy immediately** to a more reliable approach.

## Preferred strategy (file-based)

- **Generate/fix** the content locally (SQL / script).
- **Upload** to the server with `scp` to `/tmp/...`.
- **Execute as a file** on the server (no inline quoting).

Examples:

```bash
scp ./path/to/file.sql deploy@155.212.172.136:/tmp/hotfix.sql
ssh deploy@155.212.172.136 "cd /opt/memalerts-backend-beta && pnpm -s prisma db execute --file /tmp/hotfix.sql"
```

## Prisma P3009 (failed migration) playbook

If deploy fails with **P3009** (“migrate found failed migrations”):

- **Do not** keep retrying `prisma migrate deploy` — it will stay blocked.
- Fix it in this order:

```bash
ssh deploy@155.212.172.136
cd /opt/memalerts-backend-beta
pnpm -s prisma migrate status

# 1) Fix DB manually using a FILE (hotfix SQL)
# 2) Then mark migration as applied:
pnpm -s prisma migrate resolve --applied <failed_migration_name>

# 3) Continue normal deploy:
pnpm -s prisma migrate deploy
pm2 restart memalerts-api-beta
```

Notes:
- If the migration SQL is not idempotent, make it idempotent (Postgres: use `DO $$ ... $$` + `pg_constraint`/`information_schema` checks).
- Prefer **expand/contract** style changes when beta/prod share DB.


