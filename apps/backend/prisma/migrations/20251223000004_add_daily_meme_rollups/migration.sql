-- Daily meme rollups (expand-only).

-- ChannelMemeDailyStats
CREATE TABLE IF NOT EXISTS "ChannelMemeDailyStats" (
  "channelId" TEXT NOT NULL,
  "day" TIMESTAMP(3) NOT NULL,
  "memeId" TEXT NOT NULL,

  "completedActivationsCount" INTEGER NOT NULL DEFAULT 0,
  "completedCoinsSpentSum" BIGINT NOT NULL DEFAULT 0,

  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ChannelMemeDailyStats_pkey" PRIMARY KEY ("channelId","day","memeId")
);

-- GlobalMemeDailyStats
CREATE TABLE IF NOT EXISTS "GlobalMemeDailyStats" (
  "day" TIMESTAMP(3) NOT NULL,
  "memeId" TEXT NOT NULL,

  "completedActivationsCount" INTEGER NOT NULL DEFAULT 0,
  "completedCoinsSpentSum" BIGINT NOT NULL DEFAULT 0,

  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "GlobalMemeDailyStats_pkey" PRIMARY KEY ("day","memeId")
);

-- Foreign keys (add once)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ChannelMemeDailyStats_channelId_fkey') THEN
    ALTER TABLE "ChannelMemeDailyStats"
      ADD CONSTRAINT "ChannelMemeDailyStats_channelId_fkey"
      FOREIGN KEY ("channelId") REFERENCES "Channel"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ChannelMemeDailyStats_memeId_fkey') THEN
    ALTER TABLE "ChannelMemeDailyStats"
      ADD CONSTRAINT "ChannelMemeDailyStats_memeId_fkey"
      FOREIGN KEY ("memeId") REFERENCES "Meme"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'GlobalMemeDailyStats_memeId_fkey') THEN
    ALTER TABLE "GlobalMemeDailyStats"
      ADD CONSTRAINT "GlobalMemeDailyStats_memeId_fkey"
      FOREIGN KEY ("memeId") REFERENCES "Meme"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS "ChannelMemeDailyStats_channelId_day_idx"
  ON "ChannelMemeDailyStats" ("channelId","day");
CREATE INDEX IF NOT EXISTS "ChannelMemeDailyStats_channelId_memeId_idx"
  ON "ChannelMemeDailyStats" ("channelId","memeId");
CREATE INDEX IF NOT EXISTS "ChannelMemeDailyStats_day_idx"
  ON "ChannelMemeDailyStats" ("day");

CREATE INDEX IF NOT EXISTS "GlobalMemeDailyStats_day_idx"
  ON "GlobalMemeDailyStats" ("day");
CREATE INDEX IF NOT EXISTS "GlobalMemeDailyStats_memeId_idx"
  ON "GlobalMemeDailyStats" ("memeId");


