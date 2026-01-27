-- User achievements (global + per-channel)
CREATE TABLE IF NOT EXISTS "UserAchievement" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "channelId" TEXT,
  "key" TEXT NOT NULL,
  "achievedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "UserAchievement_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "UserAchievement_userId_channelId_key_key" ON "UserAchievement"("userId", "channelId", "key");
CREATE INDEX IF NOT EXISTS "UserAchievement_userId_idx" ON "UserAchievement"("userId");
CREATE INDEX IF NOT EXISTS "UserAchievement_channelId_idx" ON "UserAchievement"("channelId");
CREATE INDEX IF NOT EXISTS "UserAchievement_key_idx" ON "UserAchievement"("key");
CREATE INDEX IF NOT EXISTS "UserAchievement_achievedAt_idx" ON "UserAchievement"("achievedAt");

ALTER TABLE "UserAchievement" ADD CONSTRAINT "UserAchievement_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserAchievement" ADD CONSTRAINT "UserAchievement_channelId_fkey"
  FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
