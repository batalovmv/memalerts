-- CreateEnum
CREATE TYPE "BotIntegrationProvider" AS ENUM ('twitch', 'vkplaylive');

-- CreateTable
CREATE TABLE "BotIntegrationSettings" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "provider" "BotIntegrationProvider" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BotIntegrationSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BotIntegrationSettings_channelId_idx" ON "BotIntegrationSettings"("channelId");

-- CreateIndex
CREATE INDEX "BotIntegrationSettings_provider_enabled_idx" ON "BotIntegrationSettings"("provider", "enabled");

-- CreateIndex
CREATE INDEX "BotIntegrationSettings_enabled_idx" ON "BotIntegrationSettings"("enabled");

-- CreateIndex
CREATE UNIQUE INDEX "BotIntegrationSettings_channelId_provider_key" ON "BotIntegrationSettings"("channelId", "provider");

-- AddForeignKey
ALTER TABLE "BotIntegrationSettings" ADD CONSTRAINT "BotIntegrationSettings_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;











