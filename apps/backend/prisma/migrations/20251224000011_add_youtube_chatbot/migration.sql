-- AddEnumValue
ALTER TYPE "BotIntegrationProvider" ADD VALUE IF NOT EXISTS 'youtube';

-- CreateTable
CREATE TABLE "YouTubeChatBotSubscription" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "youtubeChannelId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "YouTubeChatBotSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "YouTubeChatBotOutboxMessage" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "youtubeChannelId" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "processingAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "YouTubeChatBotOutboxMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "YouTubeChatBotSubscription_channelId_key" ON "YouTubeChatBotSubscription"("channelId");

-- CreateIndex
CREATE INDEX "YouTubeChatBotSubscription_enabled_idx" ON "YouTubeChatBotSubscription"("enabled");

-- CreateIndex
CREATE INDEX "YouTubeChatBotSubscription_youtubeChannelId_idx" ON "YouTubeChatBotSubscription"("youtubeChannelId");

-- CreateIndex
CREATE INDEX "YouTubeChatBotSubscription_userId_idx" ON "YouTubeChatBotSubscription"("userId");

-- CreateIndex
CREATE INDEX "YouTubeChatBotSubscription_channelId_idx" ON "YouTubeChatBotSubscription"("channelId");

-- CreateIndex
CREATE INDEX "YouTubeChatBotOutboxMessage_status_createdAt_idx" ON "YouTubeChatBotOutboxMessage"("status", "createdAt");

-- CreateIndex
CREATE INDEX "YouTubeChatBotOutboxMessage_channelId_status_createdAt_idx" ON "YouTubeChatBotOutboxMessage"("channelId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "YouTubeChatBotOutboxMessage_youtubeChannelId_status_createdAt_idx" ON "YouTubeChatBotOutboxMessage"("youtubeChannelId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "YouTubeChatBotOutboxMessage_createdAt_idx" ON "YouTubeChatBotOutboxMessage"("createdAt");

-- AddForeignKey
ALTER TABLE "YouTubeChatBotSubscription" ADD CONSTRAINT "YouTubeChatBotSubscription_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "YouTubeChatBotSubscription" ADD CONSTRAINT "YouTubeChatBotSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "YouTubeChatBotOutboxMessage" ADD CONSTRAINT "YouTubeChatBotOutboxMessage_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;


