-- Boosty via Discord roles (additive, safe for shared DB):
-- - ExternalAccountProvider: add 'discord'
-- - Channel: boostyDiscordRoleId (legacy) / boostyDiscordTierRolesJson (tiers mapping)
-- - BoostyDiscordSubscriptionReward: dedupe grants (v1)
-- - BoostyDiscordSubscriptionRewardV2: dedupe grants (v2, per-user per-channel)

ALTER TYPE "ExternalAccountProvider" ADD VALUE IF NOT EXISTS 'discord';

ALTER TABLE "Channel"
  ADD COLUMN IF NOT EXISTS "boostyDiscordRoleId" TEXT;

ALTER TABLE "Channel"
  ADD COLUMN IF NOT EXISTS "boostyDiscordTierRolesJson" JSONB;

CREATE TABLE IF NOT EXISTS "BoostyDiscordSubscriptionReward" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "channelId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "discordRoleId" TEXT NOT NULL,
  "coinsGranted" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "BoostyDiscordSubscriptionReward_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BoostyDiscordSubscriptionReward_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "BoostyDiscordSubscriptionReward_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "BoostyDiscordSubscriptionReward_channelId_userId_discordRoleId_key"
  ON "BoostyDiscordSubscriptionReward"("channelId", "userId", "discordRoleId");

CREATE INDEX IF NOT EXISTS "BoostyDiscordSubscriptionReward_channelId_idx" ON "BoostyDiscordSubscriptionReward"("channelId");
CREATE INDEX IF NOT EXISTS "BoostyDiscordSubscriptionReward_userId_idx" ON "BoostyDiscordSubscriptionReward"("userId");
CREATE INDEX IF NOT EXISTS "BoostyDiscordSubscriptionReward_discordRoleId_idx" ON "BoostyDiscordSubscriptionReward"("discordRoleId");
CREATE INDEX IF NOT EXISTS "BoostyDiscordSubscriptionReward_createdAt_idx" ON "BoostyDiscordSubscriptionReward"("createdAt");

-- V2: dedupe by (channelId,userId) regardless of tier/role.
CREATE TABLE IF NOT EXISTS "BoostyDiscordSubscriptionRewardV2" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "channelId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "discordRoleId" TEXT,
  "discordTier" TEXT,
  "coinsGranted" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "BoostyDiscordSubscriptionRewardV2_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BoostyDiscordSubscriptionRewardV2_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "BoostyDiscordSubscriptionRewardV2_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "BoostyDiscordSubscriptionRewardV2_channelId_userId_key"
  ON "BoostyDiscordSubscriptionRewardV2"("channelId", "userId");

CREATE INDEX IF NOT EXISTS "BoostyDiscordSubscriptionRewardV2_channelId_idx" ON "BoostyDiscordSubscriptionRewardV2"("channelId");
CREATE INDEX IF NOT EXISTS "BoostyDiscordSubscriptionRewardV2_userId_idx" ON "BoostyDiscordSubscriptionRewardV2"("userId");
CREATE INDEX IF NOT EXISTS "BoostyDiscordSubscriptionRewardV2_createdAt_idx" ON "BoostyDiscordSubscriptionRewardV2"("createdAt");


