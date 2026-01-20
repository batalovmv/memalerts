-- Chat bot commands + follow greetings settings + event dedupe (additive, shared-DB safe)

-- Channel follow greeting settings
ALTER TABLE "Channel"
  ADD COLUMN IF NOT EXISTS "followGreetingsEnabled" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Channel"
  ADD COLUMN IF NOT EXISTS "followGreetingTemplate" TEXT;

-- Per-channel bot commands
CREATE TABLE IF NOT EXISTS "ChatBotCommand" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "triggerNormalized" TEXT NOT NULL,
    "response" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatBotCommand_pkey" PRIMARY KEY ("id")
);

-- Unique trigger per channel
CREATE UNIQUE INDEX IF NOT EXISTS "ChatBotCommand_channelId_triggerNormalized_key"
  ON "ChatBotCommand"("channelId", "triggerNormalized");

CREATE INDEX IF NOT EXISTS "ChatBotCommand_channelId_idx" ON "ChatBotCommand"("channelId");
CREATE INDEX IF NOT EXISTS "ChatBotCommand_enabled_idx" ON "ChatBotCommand"("enabled");
CREATE INDEX IF NOT EXISTS "ChatBotCommand_channelId_enabled_idx" ON "ChatBotCommand"("channelId", "enabled");
CREATE INDEX IF NOT EXISTS "ChatBotCommand_triggerNormalized_idx" ON "ChatBotCommand"("triggerNormalized");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'ChatBotCommand_channelId_fkey'
    ) THEN
        ALTER TABLE "ChatBotCommand"
        ADD CONSTRAINT "ChatBotCommand_channelId_fkey"
        FOREIGN KEY ("channelId") REFERENCES "Channel"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- Event dedupe (kind + eventId)
CREATE TABLE IF NOT EXISTS "ChatBotEventDedup" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatBotEventDedup_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ChatBotEventDedup_kind_eventId_key"
  ON "ChatBotEventDedup"("kind", "eventId");

CREATE INDEX IF NOT EXISTS "ChatBotEventDedup_channelId_idx" ON "ChatBotEventDedup"("channelId");
CREATE INDEX IF NOT EXISTS "ChatBotEventDedup_kind_idx" ON "ChatBotEventDedup"("kind");
CREATE INDEX IF NOT EXISTS "ChatBotEventDedup_createdAt_idx" ON "ChatBotEventDedup"("createdAt");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'ChatBotEventDedup_channelId_fkey'
    ) THEN
        ALTER TABLE "ChatBotEventDedup"
        ADD CONSTRAINT "ChatBotEventDedup_channelId_fkey"
        FOREIGN KEY ("channelId") REFERENCES "Channel"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;


