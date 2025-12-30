-- Boosty subscription rewards (expand-first, safe for shared DB):
-- - Channel: boostyBlogName + boostyCoinsPerSub (reward config)
-- - ExternalAccount: deviceId (for reverse-engineered refresh flows)
-- - BoostySubscriptionReward: dedupe grants

ALTER TABLE "Channel"
  ADD COLUMN IF NOT EXISTS "boostyBlogName" TEXT;

ALTER TABLE "Channel"
  ADD COLUMN IF NOT EXISTS "boostyCoinsPerSub" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "ExternalAccount"
  ADD COLUMN IF NOT EXISTS "deviceId" TEXT;

CREATE TABLE IF NOT EXISTS "BoostySubscriptionReward" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "channelId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "boostyBlogName" TEXT NOT NULL,
  "boostySubscriptionId" TEXT NOT NULL,
  "coinsGranted" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "BoostySubscriptionReward_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BoostySubscriptionReward_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "BoostySubscriptionReward_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "BoostySubscriptionReward_channelId_userId_boostySubscriptionId_key"
  ON "BoostySubscriptionReward"("channelId", "userId", "boostySubscriptionId");

CREATE INDEX IF NOT EXISTS "BoostySubscriptionReward_channelId_idx" ON "BoostySubscriptionReward"("channelId");
CREATE INDEX IF NOT EXISTS "BoostySubscriptionReward_userId_idx" ON "BoostySubscriptionReward"("userId");
CREATE INDEX IF NOT EXISTS "BoostySubscriptionReward_boostyBlogName_idx" ON "BoostySubscriptionReward"("boostyBlogName");
CREATE INDEX IF NOT EXISTS "BoostySubscriptionReward_createdAt_idx" ON "BoostySubscriptionReward"("createdAt");


