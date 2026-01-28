-- 30-day rolling window rollups (expand-only).
-- These tables are recomputed periodically by a job (see src/jobs/channelTopStats30dRollup.ts).

-- ChannelUserStats30d
CREATE TABLE IF NOT EXISTS "ChannelUserStats30d" (
  "channelId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "windowStart" TIMESTAMP(3) NOT NULL,
  "windowEnd" TIMESTAMP(3) NOT NULL,

  "totalActivationsCount" INTEGER NOT NULL DEFAULT 0,
  "totalCoinsSpentSum" BIGINT NOT NULL DEFAULT 0,
  "completedActivationsCount" INTEGER NOT NULL DEFAULT 0,
  "completedCoinsSpentSum" BIGINT NOT NULL DEFAULT 0,

  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ChannelUserStats30d_pkey" PRIMARY KEY ("channelId", "userId")
);

-- ChannelMemeStats30d
CREATE TABLE IF NOT EXISTS "ChannelMemeStats30d" (
  "channelId" TEXT NOT NULL,
  "memeId" TEXT NOT NULL,
  "windowStart" TIMESTAMP(3) NOT NULL,
  "windowEnd" TIMESTAMP(3) NOT NULL,

  "totalActivationsCount" INTEGER NOT NULL DEFAULT 0,
  "totalCoinsSpentSum" BIGINT NOT NULL DEFAULT 0,
  "completedActivationsCount" INTEGER NOT NULL DEFAULT 0,
  "completedCoinsSpentSum" BIGINT NOT NULL DEFAULT 0,

  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ChannelMemeStats30d_pkey" PRIMARY KEY ("channelId", "memeId")
);

-- GlobalMemeStats30d
CREATE TABLE IF NOT EXISTS "GlobalMemeStats30d" (
  "memeId" TEXT NOT NULL,
  "windowStart" TIMESTAMP(3) NOT NULL,
  "windowEnd" TIMESTAMP(3) NOT NULL,

  "completedActivationsCount" INTEGER NOT NULL DEFAULT 0,
  "completedCoinsSpentSum" BIGINT NOT NULL DEFAULT 0,

  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "GlobalMemeStats30d_pkey" PRIMARY KEY ("memeId")
);

-- Foreign keys (add once)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ChannelUserStats30d_channelId_fkey') THEN
    ALTER TABLE "ChannelUserStats30d"
      ADD CONSTRAINT "ChannelUserStats30d_channelId_fkey"
      FOREIGN KEY ("channelId") REFERENCES "Channel"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ChannelUserStats30d_userId_fkey') THEN
    ALTER TABLE "ChannelUserStats30d"
      ADD CONSTRAINT "ChannelUserStats30d_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ChannelMemeStats30d_channelId_fkey') THEN
    ALTER TABLE "ChannelMemeStats30d"
      ADD CONSTRAINT "ChannelMemeStats30d_channelId_fkey"
      FOREIGN KEY ("channelId") REFERENCES "Channel"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF to_regclass('"Meme"') IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ChannelMemeStats30d_memeId_fkey') THEN
    ALTER TABLE "ChannelMemeStats30d"
      ADD CONSTRAINT "ChannelMemeStats30d_memeId_fkey"
      FOREIGN KEY ("memeId") REFERENCES "Meme"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF to_regclass('"Meme"') IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'GlobalMemeStats30d_memeId_fkey') THEN
    ALTER TABLE "GlobalMemeStats30d"
      ADD CONSTRAINT "GlobalMemeStats30d_memeId_fkey"
      FOREIGN KEY ("memeId") REFERENCES "Meme"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS "ChannelUserStats30d_channelId_idx" ON "ChannelUserStats30d" ("channelId");
CREATE INDEX IF NOT EXISTS "ChannelUserStats30d_channelId_totalCoinsSpentSum_idx" ON "ChannelUserStats30d" ("channelId", "totalCoinsSpentSum");
CREATE INDEX IF NOT EXISTS "ChannelUserStats30d_channelId_totalActivationsCount_idx" ON "ChannelUserStats30d" ("channelId", "totalActivationsCount");
CREATE INDEX IF NOT EXISTS "ChannelUserStats30d_updatedAt_idx" ON "ChannelUserStats30d" ("updatedAt");

CREATE INDEX IF NOT EXISTS "ChannelMemeStats30d_channelId_idx" ON "ChannelMemeStats30d" ("channelId");
CREATE INDEX IF NOT EXISTS "ChannelMemeStats30d_channelId_completedActivationsCount_idx" ON "ChannelMemeStats30d" ("channelId", "completedActivationsCount");
CREATE INDEX IF NOT EXISTS "ChannelMemeStats30d_channelId_totalActivationsCount_idx" ON "ChannelMemeStats30d" ("channelId", "totalActivationsCount");
CREATE INDEX IF NOT EXISTS "ChannelMemeStats30d_updatedAt_idx" ON "ChannelMemeStats30d" ("updatedAt");

CREATE INDEX IF NOT EXISTS "GlobalMemeStats30d_completedActivationsCount_idx" ON "GlobalMemeStats30d" ("completedActivationsCount");
CREATE INDEX IF NOT EXISTS "GlobalMemeStats30d_updatedAt_idx" ON "GlobalMemeStats30d" ("updatedAt");


