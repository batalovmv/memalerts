#!/bin/bash
# Check and clear stuck queue items
cd /opt/memalerts-backend
export PGPASSWORD=14ypanxPtHNnwIoHhwCB

echo "=== Last 5 migrations ==="
psql -h localhost -U memalerts_user -d memalerts -c "SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY finished_at DESC LIMIT 5;"

echo ""
echo "=== Channel queue columns ==="
psql -h localhost -U memalerts_user -d memalerts -c "SELECT column_name FROM information_schema.columns WHERE table_name = 'Channel' AND (column_name LIKE '%ctivation%' OR column_name LIKE '%queue%' OR column_name LIKE '%overlay%');"

echo ""
echo "=== Recent activations (all statuses) ==="
psql -h localhost -U memalerts_user -d memalerts << 'SQL'
SELECT 
  a.id, 
  a.status,
  a."createdAt",
  ch.slug as channel
FROM "MemeActivation" a
JOIN "Channel" ch ON ch.id = a."channelId"
ORDER BY a."createdAt" DESC
LIMIT 15;
SQL

echo ""
echo "=== Stuck MemeActivation (status='queued') ==="
psql -h localhost -U memalerts_user -d memalerts << 'SQL'
SELECT 
  a.id, 
  a.status,
  cm.title as meme_title,
  u."displayName" as sender,
  a."createdAt"
FROM "MemeActivation" a
LEFT JOIN "ChannelMeme" cm ON cm.id = a."channelMemeId"
LEFT JOIN "User" u ON u.id = a."userId"
WHERE a.status = 'queued'
ORDER BY a."createdAt" DESC
LIMIT 20;
SQL

echo ""
echo "=== Count of queued ==="
psql -h localhost -U memalerts_user -d memalerts -c "SELECT COUNT(*) as stuck_count FROM \"MemeActivation\" WHERE status = 'queued';"

echo ""
echo "To clear, run with --clear flag"

if [ "$1" == "--clear" ]; then
  echo ""
  echo "=== Clearing stuck queue ==="
  psql -h localhost -U memalerts_user -d memalerts << 'SQL'
UPDATE "MemeActivation"
SET 
  status = 'cancelled',
  "endedAt" = NOW(),
  "endedReason" = 'cleared',
  "endedByRole" = 'system'
WHERE status = 'queued';

-- Also clear currentActivationId for channels with cancelled activations
UPDATE "Channel" c
SET 
  "currentActivationId" = NULL,
  "queueRevision" = "queueRevision" + 1
WHERE "currentActivationId" IN (
  SELECT id FROM "MemeActivation" WHERE status = 'cancelled' AND "endedReason" = 'cleared'
);
SQL
  echo "Done!"
fi

