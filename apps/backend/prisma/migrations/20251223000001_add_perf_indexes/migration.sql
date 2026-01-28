-- Performance indexes (expand-only, safe for shared DB).
-- Use IF NOT EXISTS to be resilient across environments.

-- Meme: list approved memes by channel ordered by createdAt.
DO $$
BEGIN
  IF to_regclass('"Meme"') IS NOT NULL THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS "Meme_channelId_status_createdAt_idx" ON "Meme" ("channelId", "status", "createdAt")';
  END IF;
END $$;

-- MemeActivation: common time-range scans per channel (daily charts / rollups).
CREATE INDEX IF NOT EXISTS "MemeActivation_channelId_createdAt_idx"
  ON "MemeActivation" ("channelId", "createdAt");

-- MemeActivation: admin stats groupBy helpers (within channel).
CREATE INDEX IF NOT EXISTS "MemeActivation_channelId_userId_idx"
  ON "MemeActivation" ("channelId", "userId");

DO $$
BEGIN
  IF to_regclass('"MemeActivation"') IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'MemeActivation' AND column_name = 'memeId'
      ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS "MemeActivation_channelId_memeId_idx" ON "MemeActivation" ("channelId", "memeId")';
  END IF;
END $$;


