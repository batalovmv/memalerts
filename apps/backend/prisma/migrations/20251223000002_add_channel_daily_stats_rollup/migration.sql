-- Add rollup table for channel daily statistics (expand-only).

CREATE TABLE IF NOT EXISTS "ChannelDailyStats" (
  "channelId" TEXT NOT NULL,
  "day" TIMESTAMP(3) NOT NULL,

  "totalActivationsCount" INTEGER NOT NULL DEFAULT 0,
  "totalCoinsSpentSum" BIGINT NOT NULL DEFAULT 0,

  "completedActivationsCount" INTEGER NOT NULL DEFAULT 0,
  "completedCoinsSpentSum" BIGINT NOT NULL DEFAULT 0,

  "uniqueUsersCountAll" INTEGER NOT NULL DEFAULT 0,
  "uniqueUsersCountCompleted" INTEGER NOT NULL DEFAULT 0,

  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ChannelDailyStats_pkey" PRIMARY KEY ("channelId", "day")
);

-- Foreign key
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ChannelDailyStats_channelId_fkey'
  ) THEN
    ALTER TABLE "ChannelDailyStats"
      ADD CONSTRAINT "ChannelDailyStats_channelId_fkey"
      FOREIGN KEY ("channelId") REFERENCES "Channel"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS "ChannelDailyStats_channelId_day_idx"
  ON "ChannelDailyStats" ("channelId", "day");

CREATE INDEX IF NOT EXISTS "ChannelDailyStats_day_idx"
  ON "ChannelDailyStats" ("day");


