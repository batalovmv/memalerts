-- YouTube "like stream" reward (viewer claim) - expand-only, safe for shared DB.
-- Adds per-channel config fields + dedupe table for exactly-once grants.

ALTER TABLE "Channel"
  ADD COLUMN IF NOT EXISTS "youtubeLikeRewardEnabled" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Channel"
  ADD COLUMN IF NOT EXISTS "youtubeLikeRewardCoins" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "Channel"
  ADD COLUMN IF NOT EXISTS "youtubeLikeRewardOnlyWhenLive" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "YouTubeLikeRewardClaim" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "channelId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "videoId" TEXT NOT NULL,
  "coinsGranted" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastCheckedAt" TIMESTAMP(3),
  "lastRating" TEXT,
  "lastError" TEXT,
  "awardedAt" TIMESTAMP(3),

  CONSTRAINT "YouTubeLikeRewardClaim_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "YouTubeLikeRewardClaim_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "YouTubeLikeRewardClaim_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "YouTubeLikeRewardClaim_channelId_userId_videoId_key"
  ON "YouTubeLikeRewardClaim"("channelId", "userId", "videoId");

CREATE INDEX IF NOT EXISTS "YouTubeLikeRewardClaim_channelId_idx" ON "YouTubeLikeRewardClaim"("channelId");
CREATE INDEX IF NOT EXISTS "YouTubeLikeRewardClaim_userId_idx" ON "YouTubeLikeRewardClaim"("userId");
CREATE INDEX IF NOT EXISTS "YouTubeLikeRewardClaim_videoId_idx" ON "YouTubeLikeRewardClaim"("videoId");
CREATE INDEX IF NOT EXISTS "YouTubeLikeRewardClaim_awardedAt_idx" ON "YouTubeLikeRewardClaim"("awardedAt");
CREATE INDEX IF NOT EXISTS "YouTubeLikeRewardClaim_lastCheckedAt_idx" ON "YouTubeLikeRewardClaim"("lastCheckedAt");




