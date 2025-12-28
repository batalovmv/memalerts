-- Add VK Video Live provider + bot tables.
-- Note: Use expand-only changes (safe for shared DB / multiple instances).

-- 1) Enums
DO $$ BEGIN
  ALTER TYPE "ExternalAccountProvider" ADD VALUE IF NOT EXISTS 'vkvideo';
EXCEPTION
  WHEN undefined_object THEN
    -- Enum might not exist yet on partial deploy; ignore.
    NULL;
END $$;

DO $$ BEGIN
  ALTER TYPE "BotIntegrationProvider" ADD VALUE IF NOT EXISTS 'vkvideo';
EXCEPTION
  WHEN undefined_object THEN
    NULL;
END $$;

-- 2) VKVideo subscriptions table
CREATE TABLE IF NOT EXISTS "VkVideoChatBotSubscription" (
  "id" TEXT NOT NULL,
  "channelId" TEXT NOT NULL,
  "vkvideoChannelId" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "VkVideoChatBotSubscription_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "VkVideoChatBotSubscription_channelId_key" ON "VkVideoChatBotSubscription"("channelId");
CREATE INDEX IF NOT EXISTS "VkVideoChatBotSubscription_enabled_idx" ON "VkVideoChatBotSubscription"("enabled");
CREATE INDEX IF NOT EXISTS "VkVideoChatBotSubscription_vkvideoChannelId_idx" ON "VkVideoChatBotSubscription"("vkvideoChannelId");
CREATE INDEX IF NOT EXISTS "VkVideoChatBotSubscription_channelId_idx" ON "VkVideoChatBotSubscription"("channelId");

DO $$ BEGIN
  ALTER TABLE "VkVideoChatBotSubscription"
    ADD CONSTRAINT "VkVideoChatBotSubscription_channelId_fkey"
    FOREIGN KEY ("channelId") REFERENCES "Channel"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 3) VKVideo outbox table
CREATE TABLE IF NOT EXISTS "VkVideoChatBotOutboxMessage" (
  "id" TEXT NOT NULL,
  "channelId" TEXT NOT NULL,
  "vkvideoChannelId" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "processingAt" TIMESTAMP(3),
  "sentAt" TIMESTAMP(3),
  "failedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "VkVideoChatBotOutboxMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "VkVideoChatBotOutboxMessage_status_createdAt_idx" ON "VkVideoChatBotOutboxMessage"("status","createdAt");
CREATE INDEX IF NOT EXISTS "VkVideoChatBotOutboxMessage_channelId_status_createdAt_idx" ON "VkVideoChatBotOutboxMessage"("channelId","status","createdAt");
CREATE INDEX IF NOT EXISTS "VkVideoChatBotOutboxMessage_vkvideoChannelId_status_createdAt_idx" ON "VkVideoChatBotOutboxMessage"("vkvideoChannelId","status","createdAt");
CREATE INDEX IF NOT EXISTS "VkVideoChatBotOutboxMessage_createdAt_idx" ON "VkVideoChatBotOutboxMessage"("createdAt");

DO $$ BEGIN
  ALTER TABLE "VkVideoChatBotOutboxMessage"
    ADD CONSTRAINT "VkVideoChatBotOutboxMessage_channelId_fkey"
    FOREIGN KEY ("channelId") REFERENCES "Channel"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;


