-- VKVideo bot credentials:
-- - GlobalVkVideoBotCredential: single default bot account (admin-linked)
-- - VkVideoBotIntegration: per-channel override (streamer-linked)

CREATE TABLE IF NOT EXISTS "VkVideoBotIntegration" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "channelId" TEXT NOT NULL,
  "externalAccountId" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "VkVideoBotIntegration_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "VkVideoBotIntegration_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "VkVideoBotIntegration_externalAccountId_fkey" FOREIGN KEY ("externalAccountId") REFERENCES "ExternalAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "VkVideoBotIntegration_channelId_key" ON "VkVideoBotIntegration"("channelId");
CREATE UNIQUE INDEX IF NOT EXISTS "VkVideoBotIntegration_externalAccountId_key" ON "VkVideoBotIntegration"("externalAccountId");
CREATE INDEX IF NOT EXISTS "VkVideoBotIntegration_enabled_idx" ON "VkVideoBotIntegration"("enabled");
CREATE INDEX IF NOT EXISTS "VkVideoBotIntegration_channelId_idx" ON "VkVideoBotIntegration"("channelId");
CREATE INDEX IF NOT EXISTS "VkVideoBotIntegration_externalAccountId_idx" ON "VkVideoBotIntegration"("externalAccountId");

CREATE TABLE IF NOT EXISTS "GlobalVkVideoBotCredential" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "externalAccountId" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "GlobalVkVideoBotCredential_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "GlobalVkVideoBotCredential_externalAccountId_fkey" FOREIGN KEY ("externalAccountId") REFERENCES "ExternalAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "GlobalVkVideoBotCredential_externalAccountId_key" ON "GlobalVkVideoBotCredential"("externalAccountId");
CREATE INDEX IF NOT EXISTS "GlobalVkVideoBotCredential_enabled_idx" ON "GlobalVkVideoBotCredential"("enabled");
CREATE INDEX IF NOT EXISTS "GlobalVkVideoBotCredential_externalAccountId_idx" ON "GlobalVkVideoBotCredential"("externalAccountId");


