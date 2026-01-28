-- Add compound indexes to speed up popularity/favorites queries on MemeActivation
-- Created: 2025-12-22

-- Popularity: filter by channelId + status + createdAt (range), group by memeId
DO $$
BEGIN
  IF to_regclass('"MemeActivation"') IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'MemeActivation' AND column_name = 'memeId'
      ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS "MemeActivation_channelId_status_createdAt_memeId_idx" ON "MemeActivation" ("channelId", "status", "createdAt", "memeId")';
  END IF;
END $$;

-- Favorites: filter by channelId + userId + status, group by memeId
DO $$
BEGIN
  IF to_regclass('"MemeActivation"') IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'MemeActivation' AND column_name = 'memeId'
      ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS "MemeActivation_channelId_userId_status_memeId_idx" ON "MemeActivation" ("channelId", "userId", "status", "memeId")';
  END IF;
END $$;


