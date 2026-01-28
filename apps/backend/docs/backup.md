# Backup and Disaster Recovery

## Goals
- RPO: 1 hour
- RTO: 1 hour

## Backup schedule and retention
- Schedule: hourly (top of the hour).
- Retention: 30 days (adjust per compliance or storage constraints).
- Storage: keep backups on the VPS and copy to off-host storage if available.

## Manual backup
```bash
pg_dump -Fc "$DATABASE_URL" > /backups/memalerts-$(date +%Y%m%d-%H%M).dump
```

## Manual restore
```bash
pg_restore --clean --if-exists --no-owner --dbname "$DATABASE_URL" /backups/memalerts-YYYYMMDD-HHMM.dump
```

## Local verification (Docker)

If `pg_restore` is not available on your workstation, you can still verify dumps via Docker:

```bash
# Create a local dump from a running Postgres container (example name: memalerts_postgres)
docker exec memalerts_postgres pg_dump -U postgres -d memalerts -F c > ./tmp/backup.dump

# Verify the dump is readable (no restore needed yet)
docker run --rm -v "$(pwd)/tmp:/backups" postgres:16 pg_restore --list /backups/backup.dump >/dev/null

# Optional restore drill (temp DB inside the container)
docker exec memalerts_postgres psql -U postgres -d memalerts -c "DROP DATABASE IF EXISTS memalerts_restore_test"
docker exec memalerts_postgres psql -U postgres -d memalerts -c "CREATE DATABASE memalerts_restore_test"
docker exec memalerts_postgres pg_restore -U postgres -d memalerts_restore_test --clean --if-exists /tmp/backup.dump
```

## Backup script example (VPS only, do not commit)
```bash
#!/bin/bash
# /usr/local/bin/backup-db.sh (NOT in repo, only on VPS)
set -euo pipefail
pg_dump -Fc "$DATABASE_URL" > /backups/memalerts-$(date +%Y%m%d-%H%M).dump
find /backups -name "memalerts-*.dump" -mtime +30 -delete
```

## VPS cron example
```cron
0 * * * * /usr/local/bin/backup-db.sh
```

## Backup verification script

Run the verification script to ensure the latest dump is readable and fresh:

```bash
pnpm backup:verify
```

Optional env overrides:
- `BACKUP_DIR` (default `/backups`)
- `BACKUP_GLOB` (default `memalerts-*.dump`)
- `BACKUP_MAX_AGE_HOURS` (default `2`)
- `BACKUP_FILE` (use a specific file)

Example cron (verify every hour, alert on failure):
```cron
10 * * * * cd /opt/memalerts-backend && BACKUP_DIR=/backups pnpm backup:verify
```

## Recovery runbook (step-by-step)

1) Confirm incident scope and select restore point (timestamp).
2) Provision target database (or isolate the existing instance for restore).
3) Restore the chosen dump (`pg_restore` command above).
4) Deploy the matching release tag/commit to the API.
5) Run `pnpm prisma migrate deploy` to apply any pending migrations.
6) Verify `/health` and `/readyz`, plus a sample read/write flow.
7) Switch traffic or update `DATABASE_URL` to the recovered DB.
8) Record recovery timestamps and lessons learned.

## Migration replay strategy

- Do not rely on re-running all historical migrations from scratch.
- Restore from a recent production backup, then apply **pending** migrations for the target release (`prisma migrate deploy`).
- If a migration was mid-flight, prefer rolling **forward** with the target release instead of rolling back.

## Restore drill cadence

- Run the recovery runbook **quarterly**.
- Restore into a staging DB, run the verification checks, and record RTO/RPO achieved.
