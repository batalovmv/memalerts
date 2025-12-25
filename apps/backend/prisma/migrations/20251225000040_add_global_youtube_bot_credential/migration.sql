-- Global shared YouTube bot credential (single default MemAlerts bot account).
-- Linked by admin once; used when a channel has no per-channel YouTubeBotIntegration override.

CREATE TABLE IF NOT EXISTS "GlobalYouTubeBotCredential" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "externalAccountId" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "GlobalYouTubeBotCredential_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "GlobalYouTubeBotCredential_externalAccountId_fkey" FOREIGN KEY ("externalAccountId") REFERENCES "ExternalAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "GlobalYouTubeBotCredential_externalAccountId_key" ON "GlobalYouTubeBotCredential"("externalAccountId");
CREATE INDEX IF NOT EXISTS "GlobalYouTubeBotCredential_enabled_idx" ON "GlobalYouTubeBotCredential"("enabled");
CREATE INDEX IF NOT EXISTS "GlobalYouTubeBotCredential_externalAccountId_idx" ON "GlobalYouTubeBotCredential"("externalAccountId");


