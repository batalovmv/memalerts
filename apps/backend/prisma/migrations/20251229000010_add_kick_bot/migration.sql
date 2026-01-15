-- Kick bot support (additive, safe for shared DB / multiple instances).
-- Adds:
-- - BotIntegrationProvider enum value: kick
-- - Kick bot tables: subscriptions + outbox + bot credentials (global + per-channel override)
--
-- NOTE:
-- ExternalAccountProvider already includes 'kick' in this repo.

-- 1) BotIntegrationProvider enum (expand-only)
DO $$ BEGIN
  ALTER TYPE "BotIntegrationProvider" ADD VALUE IF NOT EXISTS 'kick';
EXCEPTION
  WHEN undefined_object THEN NULL;
END $$;

-- 2) Kick subscriptions table
CREATE TABLE IF NOT EXISTS "KickChatBotSubscription" (
  "id" TEXT NOT NULL,
  "channelId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "kickChannelId" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "KickChatBotSubscription_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "KickChatBotSubscription_channelId_key" ON "KickChatBotSubscription"("channelId");
CREATE INDEX IF NOT EXISTS "KickChatBotSubscription_enabled_idx" ON "KickChatBotSubscription"("enabled");
CREATE INDEX IF NOT EXISTS "KickChatBotSubscription_kickChannelId_idx" ON "KickChatBotSubscription"("kickChannelId");
CREATE INDEX IF NOT EXISTS "KickChatBotSubscription_userId_idx" ON "KickChatBotSubscription"("userId");
CREATE INDEX IF NOT EXISTS "KickChatBotSubscription_channelId_idx" ON "KickChatBotSubscription"("channelId");

DO $$ BEGIN
  ALTER TABLE "KickChatBotSubscription"
    ADD CONSTRAINT "KickChatBotSubscription_channelId_fkey"
    FOREIGN KEY ("channelId") REFERENCES "Channel"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "KickChatBotSubscription"
    ADD CONSTRAINT "KickChatBotSubscription_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 3) Kick outbox table
CREATE TABLE IF NOT EXISTS "KickChatBotOutboxMessage" (
  "id" TEXT NOT NULL,
  "channelId" TEXT NOT NULL,
  "kickChannelId" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "processingAt" TIMESTAMP(3),
  "sentAt" TIMESTAMP(3),
  "failedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "KickChatBotOutboxMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "KickChatBotOutboxMessage_status_createdAt_idx" ON "KickChatBotOutboxMessage"("status","createdAt");
CREATE INDEX IF NOT EXISTS "KickChatBotOutboxMessage_channelId_status_createdAt_idx" ON "KickChatBotOutboxMessage"("channelId","status","createdAt");
CREATE INDEX IF NOT EXISTS "KickChatBotOutboxMessage_kickChannelId_status_createdAt_idx" ON "KickChatBotOutboxMessage"("kickChannelId","status","createdAt");
CREATE INDEX IF NOT EXISTS "KickChatBotOutboxMessage_createdAt_idx" ON "KickChatBotOutboxMessage"("createdAt");

DO $$ BEGIN
  ALTER TABLE "KickChatBotOutboxMessage"
    ADD CONSTRAINT "KickChatBotOutboxMessage_channelId_fkey"
    FOREIGN KEY ("channelId") REFERENCES "Channel"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 4) Kick bot credentials: per-channel override + global shared sender
CREATE TABLE IF NOT EXISTS "KickBotIntegration" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "channelId" TEXT NOT NULL,
  "externalAccountId" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "KickBotIntegration_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "KickBotIntegration_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "KickBotIntegration_externalAccountId_fkey" FOREIGN KEY ("externalAccountId") REFERENCES "ExternalAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "KickBotIntegration_channelId_key" ON "KickBotIntegration"("channelId");
CREATE UNIQUE INDEX IF NOT EXISTS "KickBotIntegration_externalAccountId_key" ON "KickBotIntegration"("externalAccountId");
CREATE INDEX IF NOT EXISTS "KickBotIntegration_enabled_idx" ON "KickBotIntegration"("enabled");
CREATE INDEX IF NOT EXISTS "KickBotIntegration_channelId_idx" ON "KickBotIntegration"("channelId");
CREATE INDEX IF NOT EXISTS "KickBotIntegration_externalAccountId_idx" ON "KickBotIntegration"("externalAccountId");

CREATE TABLE IF NOT EXISTS "GlobalKickBotCredential" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "externalAccountId" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "GlobalKickBotCredential_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "GlobalKickBotCredential_externalAccountId_fkey" FOREIGN KEY ("externalAccountId") REFERENCES "ExternalAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "GlobalKickBotCredential_externalAccountId_key" ON "GlobalKickBotCredential"("externalAccountId");
CREATE INDEX IF NOT EXISTS "GlobalKickBotCredential_enabled_idx" ON "GlobalKickBotCredential"("enabled");
CREATE INDEX IF NOT EXISTS "GlobalKickBotCredential_externalAccountId_idx" ON "GlobalKickBotCredential"("externalAccountId");




















