-- Twitch bot credentials:
-- - GlobalTwitchBotCredential: single default bot account (admin-linked)
-- - TwitchBotIntegration: per-channel override (streamer-linked)

CREATE TABLE IF NOT EXISTS "TwitchBotIntegration" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "channelId" TEXT NOT NULL,
  "externalAccountId" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "TwitchBotIntegration_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TwitchBotIntegration_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TwitchBotIntegration_externalAccountId_fkey" FOREIGN KEY ("externalAccountId") REFERENCES "ExternalAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "TwitchBotIntegration_channelId_key" ON "TwitchBotIntegration"("channelId");
CREATE UNIQUE INDEX IF NOT EXISTS "TwitchBotIntegration_externalAccountId_key" ON "TwitchBotIntegration"("externalAccountId");
CREATE INDEX IF NOT EXISTS "TwitchBotIntegration_enabled_idx" ON "TwitchBotIntegration"("enabled");
CREATE INDEX IF NOT EXISTS "TwitchBotIntegration_channelId_idx" ON "TwitchBotIntegration"("channelId");
CREATE INDEX IF NOT EXISTS "TwitchBotIntegration_externalAccountId_idx" ON "TwitchBotIntegration"("externalAccountId");

CREATE TABLE IF NOT EXISTS "GlobalTwitchBotCredential" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "externalAccountId" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "GlobalTwitchBotCredential_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "GlobalTwitchBotCredential_externalAccountId_fkey" FOREIGN KEY ("externalAccountId") REFERENCES "ExternalAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "GlobalTwitchBotCredential_externalAccountId_key" ON "GlobalTwitchBotCredential"("externalAccountId");
CREATE INDEX IF NOT EXISTS "GlobalTwitchBotCredential_enabled_idx" ON "GlobalTwitchBotCredential"("enabled");
CREATE INDEX IF NOT EXISTS "GlobalTwitchBotCredential_externalAccountId_idx" ON "GlobalTwitchBotCredential"("externalAccountId");


