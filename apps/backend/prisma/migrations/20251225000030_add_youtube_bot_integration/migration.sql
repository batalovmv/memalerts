-- Per-channel YouTube bot override (optional):
-- - Adds OAuthState.kind = 'bot_link' and OAuthState.channelId to support linking a separate bot account for a channel.
-- - Adds YouTubeBotIntegration table mapping Channel -> ExternalAccount to use as a sender for YouTube chat messages.

-- 1) Extend OAuthStateKind enum with bot_link (safe if already exists).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'OAuthStateKind') THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'OAuthStateKind' AND e.enumlabel = 'bot_link'
    ) THEN
      ALTER TYPE "OAuthStateKind" ADD VALUE 'bot_link';
    END IF;
  END IF;
END $$;

-- 2) Add channelId to OAuthState for bot_link flows.
ALTER TABLE "OAuthState"
  ADD COLUMN IF NOT EXISTS "channelId" TEXT;

CREATE INDEX IF NOT EXISTS "OAuthState_channelId_idx" ON "OAuthState"("channelId");

-- 3) Create YouTubeBotIntegration table.
CREATE TABLE IF NOT EXISTS "YouTubeBotIntegration" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "channelId" TEXT NOT NULL,
  "externalAccountId" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "YouTubeBotIntegration_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "YouTubeBotIntegration_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "YouTubeBotIntegration_externalAccountId_fkey" FOREIGN KEY ("externalAccountId") REFERENCES "ExternalAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "YouTubeBotIntegration_channelId_key" ON "YouTubeBotIntegration"("channelId");
CREATE UNIQUE INDEX IF NOT EXISTS "YouTubeBotIntegration_externalAccountId_key" ON "YouTubeBotIntegration"("externalAccountId");
CREATE INDEX IF NOT EXISTS "YouTubeBotIntegration_enabled_idx" ON "YouTubeBotIntegration"("enabled");
CREATE INDEX IF NOT EXISTS "YouTubeBotIntegration_channelId_idx" ON "YouTubeBotIntegration"("channelId");
CREATE INDEX IF NOT EXISTS "YouTubeBotIntegration_externalAccountId_idx" ON "YouTubeBotIntegration"("externalAccountId");


