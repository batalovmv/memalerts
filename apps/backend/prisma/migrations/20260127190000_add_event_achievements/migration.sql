-- CreateTable
CREATE TABLE "EventAchievement" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "targetActivations" INTEGER,
    "rewardCoins" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventAchievement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserEventAchievement" (
    "id" TEXT NOT NULL,
    "eventAchievementId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channelId" TEXT,
    "achievedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserEventAchievement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EventAchievement_eventId_key" ON "EventAchievement"("eventId", "key");

-- CreateIndex
CREATE INDEX "EventAchievement_eventId_idx" ON "EventAchievement"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "UserEventAchievement_eventAchievementId_userId_key" ON "UserEventAchievement"("eventAchievementId", "userId");

-- CreateIndex
CREATE INDEX "UserEventAchievement_eventAchievementId_idx" ON "UserEventAchievement"("eventAchievementId");

-- CreateIndex
CREATE INDEX "UserEventAchievement_userId_idx" ON "UserEventAchievement"("userId");

-- CreateIndex
CREATE INDEX "UserEventAchievement_channelId_idx" ON "UserEventAchievement"("channelId");

-- CreateIndex
CREATE INDEX "UserEventAchievement_achievedAt_idx" ON "UserEventAchievement"("achievedAt");

-- AddForeignKey
ALTER TABLE "EventAchievement" ADD CONSTRAINT "EventAchievement_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "SeasonalEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserEventAchievement" ADD CONSTRAINT "UserEventAchievement_eventAchievementId_fkey" FOREIGN KEY ("eventAchievementId") REFERENCES "EventAchievement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserEventAchievement" ADD CONSTRAINT "UserEventAchievement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserEventAchievement" ADD CONSTRAINT "UserEventAchievement_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE SET NULL ON UPDATE CASCADE;
