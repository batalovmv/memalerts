-- Trovo bot support (additive, safe for shared DB / multiple instances).
-- Adds:
-- - ExternalAccountProvider enum value: trovo
-- - BotIntegrationProvider enum value: trovo
-- - Trovo bot tables: subscriptions + outbox + bot credentials (global + per-channel override)

-- 1) Enums (expand-only)
DO $$ BEGIN
  ALTER TYPE "ExternalAccountProvider" ADD VALUE IF NOT EXISTS 'trovo';
EXCEPTION
  WHEN undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TYPE "BotIntegrationProvider" ADD VALUE IF NOT EXISTS 'trovo';
EXCEPTION
  WHEN undefined_object THEN NULL;
END $$;

-- 2) Trovo subscriptions table
CREATE TABLE IF NOT EXISTS "TrovoChatBotSubscription" (
  "id" TEXT NOT NULL,
  "channelId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "trovoChannelId" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "TrovoChatBotSubscription_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "TrovoChatBotSubscription_channelId_key" ON "TrovoChatBotSubscription"("channelId");
CREATE INDEX IF NOT EXISTS "TrovoChatBotSubscription_enabled_idx" ON "TrovoChatBotSubscription"("enabled");
CREATE INDEX IF NOT EXISTS "TrovoChatBotSubscription_trovoChannelId_idx" ON "TrovoChatBotSubscription"("trovoChannelId");
CREATE INDEX IF NOT EXISTS "TrovoChatBotSubscription_userId_idx" ON "TrovoChatBotSubscription"("userId");
CREATE INDEX IF NOT EXISTS "TrovoChatBotSubscription_channelId_idx" ON "TrovoChatBotSubscription"("channelId");

DO $$ BEGIN
  ALTER TABLE "TrovoChatBotSubscription"
    ADD CONSTRAINT "TrovoChatBotSubscription_channelId_fkey"
    FOREIGN KEY ("channelId") REFERENCES "Channel"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "TrovoChatBotSubscription"
    ADD CONSTRAINT "TrovoChatBotSubscription_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 3) Trovo outbox table
CREATE TABLE IF NOT EXISTS "TrovoChatBotOutboxMessage" (
  "id" TEXT NOT NULL,
  "channelId" TEXT NOT NULL,
  "trovoChannelId" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "processingAt" TIMESTAMP(3),
  "sentAt" TIMESTAMP(3),
  "failedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "TrovoChatBotOutboxMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "TrovoChatBotOutboxMessage_status_createdAt_idx" ON "TrovoChatBotOutboxMessage"("status","createdAt");
CREATE INDEX IF NOT EXISTS "TrovoChatBotOutboxMessage_channelId_status_createdAt_idx" ON "TrovoChatBotOutboxMessage"("channelId","status","createdAt");
CREATE INDEX IF NOT EXISTS "TrovoChatBotOutboxMessage_trovoChannelId_status_createdAt_idx" ON "TrovoChatBotOutboxMessage"("trovoChannelId","status","createdAt");
CREATE INDEX IF NOT EXISTS "TrovoChatBotOutboxMessage_createdAt_idx" ON "TrovoChatBotOutboxMessage"("createdAt");

DO $$ BEGIN
  ALTER TABLE "TrovoChatBotOutboxMessage"
    ADD CONSTRAINT "TrovoChatBotOutboxMessage_channelId_fkey"
    FOREIGN KEY ("channelId") REFERENCES "Channel"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 4) Trovo bot credentials: per-channel override + global shared sender
CREATE TABLE IF NOT EXISTS "TrovoBotIntegration" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "channelId" TEXT NOT NULL,
  "externalAccountId" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "TrovoBotIntegration_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TrovoBotIntegration_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TrovoBotIntegration_externalAccountId_fkey" FOREIGN KEY ("externalAccountId") REFERENCES "ExternalAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "TrovoBotIntegration_channelId_key" ON "TrovoBotIntegration"("channelId");
CREATE UNIQUE INDEX IF NOT EXISTS "TrovoBotIntegration_externalAccountId_key" ON "TrovoBotIntegration"("externalAccountId");
CREATE INDEX IF NOT EXISTS "TrovoBotIntegration_enabled_idx" ON "TrovoBotIntegration"("enabled");
CREATE INDEX IF NOT EXISTS "TrovoBotIntegration_channelId_idx" ON "TrovoBotIntegration"("channelId");
CREATE INDEX IF NOT EXISTS "TrovoBotIntegration_externalAccountId_idx" ON "TrovoBotIntegration"("externalAccountId");

CREATE TABLE IF NOT EXISTS "GlobalTrovoBotCredential" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "externalAccountId" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "GlobalTrovoBotCredential_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "GlobalTrovoBotCredential_externalAccountId_fkey" FOREIGN KEY ("externalAccountId") REFERENCES "ExternalAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "GlobalTrovoBotCredential_externalAccountId_key" ON "GlobalTrovoBotCredential"("externalAccountId");
CREATE INDEX IF NOT EXISTS "GlobalTrovoBotCredential_enabled_idx" ON "GlobalTrovoBotCredential"("enabled");
CREATE INDEX IF NOT EXISTS "GlobalTrovoBotCredential_externalAccountId_idx" ON "GlobalTrovoBotCredential"("externalAccountId");




















