-- Global Twitch IRC bot subscriptions (single bot joins multiple channels)
CREATE TABLE IF NOT EXISTS "ChatBotSubscription" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "twitchLogin" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatBotSubscription_pkey" PRIMARY KEY ("id")
);

-- One subscription per channel
CREATE UNIQUE INDEX IF NOT EXISTS "ChatBotSubscription_channelId_key" ON "ChatBotSubscription"("channelId");

-- Lookup helpers
CREATE INDEX IF NOT EXISTS "ChatBotSubscription_enabled_idx" ON "ChatBotSubscription"("enabled");
CREATE INDEX IF NOT EXISTS "ChatBotSubscription_twitchLogin_idx" ON "ChatBotSubscription"("twitchLogin");
CREATE INDEX IF NOT EXISTS "ChatBotSubscription_channelId_idx" ON "ChatBotSubscription"("channelId");

-- FK
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'ChatBotSubscription_channelId_fkey'
    ) THEN
        ALTER TABLE "ChatBotSubscription"
        ADD CONSTRAINT "ChatBotSubscription_channelId_fkey"
        FOREIGN KEY ("channelId") REFERENCES "Channel"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;









