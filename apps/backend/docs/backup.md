# Backup and restore

## Goals
- RPO: 1 hour
- RTO: 2 hours

## Manual backup
```bash
pg_dump -Fc "$DATABASE_URL" > /backups/memalerts-$(date +%Y%m%d-%H%M).dump
```

## Manual restore
```bash
pg_restore --clean --if-exists --no-owner --dbname "$DATABASE_URL" /backups/memalerts-YYYYMMDD-HHMM.dump
```

## VPS cron example
```cron
0 * * * * /usr/local/bin/backup-db.sh
```

## Backup script example (VPS only, do not commit)
```bash
#!/bin/bash
# scripts/backup-db.sh (NOT in repo, only on VPS)
pg_dump -Fc "$DATABASE_URL" > /backups/memalerts-$(date +%Y%m%d-%H%M).dump
find /backups -name "memalerts-*.dump" -mtime +30 -delete
```

## Restore drill
- Restore the latest dump into a staging database.
- Verify `/readyz` and a sample read/write flow.
- Record the start/end time to validate RTO.
