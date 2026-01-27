-- Add economy settings to Channel
ALTER TABLE "Channel" ADD COLUMN "economyMemesPerHour" INTEGER NOT NULL DEFAULT 2;
ALTER TABLE "Channel" ADD COLUMN "economyRewardMultiplier" DOUBLE PRECISION NOT NULL DEFAULT 1.0;
ALTER TABLE "Channel" ADD COLUMN "economyApprovalBonusCoins" INTEGER NOT NULL DEFAULT 0;

-- Stream provider enum
DO $$ BEGIN
  CREATE TYPE "StreamProvider" AS ENUM ('twitch', 'vkvideo', 'unknown');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Stream sessions
CREATE TABLE IF NOT EXISTS "StreamSession" (
  "id" TEXT NOT NULL,
  "channelId" TEXT NOT NULL,
  "provider" "StreamProvider" NOT NULL DEFAULT 'unknown',
  "startedAt" TIMESTAMP(3) NOT NULL,
  "endedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "StreamSession_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "StreamSession_channelId_startedAt_idx" ON "StreamSession"("channelId", "startedAt");
CREATE INDEX IF NOT EXISTS "StreamSession_channelId_endedAt_idx" ON "StreamSession"("channelId", "endedAt");
CREATE INDEX IF NOT EXISTS "StreamSession_provider_startedAt_idx" ON "StreamSession"("provider", "startedAt");

ALTER TABLE "StreamSession" ADD CONSTRAINT "StreamSession_channelId_fkey"
  FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Viewer economy state
CREATE TABLE IF NOT EXISTS "ChannelViewerEconomy" (
  "id" TEXT NOT NULL,
  "channelId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "dailyBonusLastClaimAt" TIMESTAMP(3),
  "watchBonusLastClaimAt" TIMESTAMP(3),
  "watchBonusClaimCount" INTEGER NOT NULL DEFAULT 0,
  "watchBonusSessionId" TEXT,
  "startBonusGrantedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ChannelViewerEconomy_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ChannelViewerEconomy_channelId_userId_key" ON "ChannelViewerEconomy"("channelId", "userId");
CREATE INDEX IF NOT EXISTS "ChannelViewerEconomy_userId_idx" ON "ChannelViewerEconomy"("userId");
CREATE INDEX IF NOT EXISTS "ChannelViewerEconomy_channelId_idx" ON "ChannelViewerEconomy"("channelId");
CREATE INDEX IF NOT EXISTS "ChannelViewerEconomy_watchBonusSessionId_idx" ON "ChannelViewerEconomy"("watchBonusSessionId");
CREATE INDEX IF NOT EXISTS "ChannelViewerEconomy_dailyBonusLastClaimAt_idx" ON "ChannelViewerEconomy"("dailyBonusLastClaimAt");
CREATE INDEX IF NOT EXISTS "ChannelViewerEconomy_watchBonusLastClaimAt_idx" ON "ChannelViewerEconomy"("watchBonusLastClaimAt");

ALTER TABLE "ChannelViewerEconomy" ADD CONSTRAINT "ChannelViewerEconomy_channelId_fkey"
  FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChannelViewerEconomy" ADD CONSTRAINT "ChannelViewerEconomy_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChannelViewerEconomy" ADD CONSTRAINT "ChannelViewerEconomy_watchBonusSessionId_fkey"
  FOREIGN KEY ("watchBonusSessionId") REFERENCES "StreamSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
