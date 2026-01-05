-- Add retry scheduling for Kick chat bot outbox (backoff/retries).
ALTER TABLE "KickChatBotOutboxMessage"
ADD COLUMN IF NOT EXISTS "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Helps polling runner efficiently pick due messages.
CREATE INDEX IF NOT EXISTS "KickChatBotOutboxMessage_status_nextAttemptAt_createdAt_idx"
ON "KickChatBotOutboxMessage" ("status", "nextAttemptAt", "createdAt");





