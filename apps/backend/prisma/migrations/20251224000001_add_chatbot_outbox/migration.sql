-- Chat bot outbox for sending messages via separate chatbotRunner process.
-- Additive and shared-DB safe.

CREATE TABLE IF NOT EXISTS "ChatBotOutboxMessage" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "twitchLogin" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "processingAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatBotOutboxMessage_pkey" PRIMARY KEY ("id")
);

-- Indexes for polling (runner reads pending in createdAt order)
CREATE INDEX IF NOT EXISTS "ChatBotOutboxMessage_status_createdAt_idx"
  ON "ChatBotOutboxMessage"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "ChatBotOutboxMessage_channelId_status_createdAt_idx"
  ON "ChatBotOutboxMessage"("channelId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "ChatBotOutboxMessage_twitchLogin_status_createdAt_idx"
  ON "ChatBotOutboxMessage"("twitchLogin", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "ChatBotOutboxMessage_createdAt_idx"
  ON "ChatBotOutboxMessage"("createdAt");

-- FK
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'ChatBotOutboxMessage_channelId_fkey'
    ) THEN
        ALTER TABLE "ChatBotOutboxMessage"
        ADD CONSTRAINT "ChatBotOutboxMessage_channelId_fkey"
        FOREIGN KEY ("channelId") REFERENCES "Channel"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;


