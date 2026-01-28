CREATE TABLE "Channel" (
    "id" TEXT NOT NULL,
    "twitchChannelId" TEXT,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rewardIdForCoins" TEXT,
    "coinPerPointRatio" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "rewardEnabled" BOOLEAN NOT NULL DEFAULT false,
    "rewardTitle" TEXT,
    "rewardCost" INTEGER,
    "rewardCoins" INTEGER,
    "rewardOnlyWhenLive" BOOLEAN NOT NULL DEFAULT false,
    "vkvideoRewardEnabled" BOOLEAN NOT NULL DEFAULT false,
    "vkvideoRewardIdForCoins" TEXT,
    "vkvideoCoinPerPointRatio" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "vkvideoRewardCoins" INTEGER,
    "vkvideoRewardOnlyWhenLive" BOOLEAN NOT NULL DEFAULT false,
    "coinIconUrl" TEXT,
    "primaryColor" TEXT,
    "secondaryColor" TEXT,
    "accentColor" TEXT,
    "defaultPriceCoins" INTEGER DEFAULT 100,
    "memeCatalogMode" TEXT NOT NULL DEFAULT 'channel',
    "submissionRewardCoins" INTEGER NOT NULL DEFAULT 0,
    "submissionRewardCoinsUpload" INTEGER NOT NULL DEFAULT 0,
    "submissionRewardCoinsPool" INTEGER NOT NULL DEFAULT 100,
    "submissionRewardOnlyWhenLive" BOOLEAN NOT NULL DEFAULT false,
    "submissionsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "submissionsOnlyWhenLive" BOOLEAN NOT NULL DEFAULT false,
    "autoApproveEnabled" BOOLEAN NOT NULL DEFAULT false,
    "submissionsControlTokenHash" TEXT,
    "overlayMode" TEXT NOT NULL DEFAULT 'queue',
    "overlayShowSender" BOOLEAN NOT NULL DEFAULT false,
    "overlayMaxConcurrent" INTEGER NOT NULL DEFAULT 3,
    "overlayStyleJson" TEXT,
    "overlayPresetsJson" TEXT,
    "overlayTokenVersion" INTEGER NOT NULL DEFAULT 1,
    "dashboardCardOrder" JSONB,
    "economyMemesPerHour" INTEGER NOT NULL DEFAULT 2,
    "economyRewardMultiplier" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "economyApprovalBonusCoins" INTEGER NOT NULL DEFAULT 0,
    "wheelEnabled" BOOLEAN NOT NULL DEFAULT true,
    "wheelPaidSpinCostCoins" INTEGER,
    "wheelPrizeMultiplier" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Channel_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "twitchUserId" TEXT,
    "displayName" TEXT NOT NULL,
    "profileImageUrl" TEXT,
    "role" TEXT NOT NULL,
    "channelId" TEXT,
    "twitchAccessToken" TEXT,
    "twitchRefreshToken" TEXT,
    "hasBetaAccess" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Wallet" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Wallet_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "UserBanState" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "banCount" INTEGER NOT NULL DEFAULT 0,
    "currentBanUntil" TIMESTAMP(3),
    "lastBanAt" TIMESTAMP(3),
    "banDecayAt" TIMESTAMP(3),
    "reason" TEXT,

    CONSTRAINT "UserBanState_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MemeSubmission" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "submitterUserId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "fileUrlTemp" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "memeAssetId" TEXT,
    "sourceKind" TEXT NOT NULL DEFAULT 'upload',
    "notes" TEXT,
    "idempotencyKey" VARCHAR(128),
    "status" TEXT NOT NULL,
    "moderatorNotes" TEXT,
    "fileHash" VARCHAR(64),
    "durationMs" INTEGER,
    "mimeType" VARCHAR(64),
    "fileSizeBytes" INTEGER,
    "aiStatus" TEXT NOT NULL DEFAULT 'pending',
    "aiDecision" VARCHAR(16),
    "aiRiskScore" DOUBLE PRECISION,
    "aiLabelsJson" JSONB,
    "aiTranscript" VARCHAR(50000),
    "aiAutoTagNamesJson" JSONB,
    "aiAutoDescription" VARCHAR(2000),
    "aiModelVersionsJson" JSONB,
    "aiCompletedAt" TIMESTAMP(3),
    "aiRetryCount" INTEGER NOT NULL DEFAULT 0,
    "aiLastTriedAt" TIMESTAMP(3),
    "aiProcessingStartedAt" TIMESTAMP(3),
    "aiLockedBy" VARCHAR(128),
    "aiLockExpiresAt" TIMESTAMP(3),
    "aiNextRetryAt" TIMESTAMP(3),
    "aiError" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MemeSubmission_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Redemption" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "twitchRedemptionId" TEXT NOT NULL,
    "pointsSpent" INTEGER NOT NULL,
    "coinsGranted" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Redemption_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MemeActivation" (
    "id" TEXT NOT NULL,
    "channelMemeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "priceCoins" INTEGER NOT NULL,
    "volume" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "playedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "MemeActivation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "channelId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "payloadJson" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ChannelMemeTag" (
    "id" TEXT NOT NULL,
    "channelMemeId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    CONSTRAINT "ChannelMemeTag_pkey" PRIMARY KEY ("id")
);



CREATE UNIQUE INDEX "Channel_twitchChannelId_key" ON "Channel"("twitchChannelId");

CREATE UNIQUE INDEX "Channel_slug_key" ON "Channel"("slug");

CREATE UNIQUE INDEX "Channel_submissionsControlTokenHash_key" ON "Channel"("submissionsControlTokenHash");

CREATE UNIQUE INDEX "User_twitchUserId_key" ON "User"("twitchUserId");

CREATE INDEX "User_twitchUserId_idx" ON "User"("twitchUserId");

CREATE INDEX "User_channelId_idx" ON "User"("channelId");

CREATE INDEX "Wallet_userId_idx" ON "Wallet"("userId");

CREATE UNIQUE INDEX "UserBanState_userId_key" ON "UserBanState"("userId");

CREATE INDEX "MemeSubmission_channelId_idx" ON "MemeSubmission"("channelId");

CREATE INDEX "MemeSubmission_status_idx" ON "MemeSubmission"("status");

CREATE INDEX "MemeSubmission_submitterUserId_idx" ON "MemeSubmission"("submitterUserId");

CREATE INDEX "MemeSubmission_memeAssetId_idx" ON "MemeSubmission"("memeAssetId");

CREATE INDEX "MemeSubmission_sourceKind_idx" ON "MemeSubmission"("sourceKind");

CREATE INDEX "MemeSubmission_fileHash_idx" ON "MemeSubmission"("fileHash");

CREATE INDEX "MemeSubmission_status_sourceKind_aiStatus_aiNextRetryAt_cre_idx" ON "MemeSubmission"("status", "sourceKind", "aiStatus", "aiNextRetryAt", "createdAt");

CREATE INDEX "MemeSubmission_aiStatus_aiLockExpiresAt_idx" ON "MemeSubmission"("aiStatus", "aiLockExpiresAt");

CREATE INDEX "MemeSubmission_channelId_status_createdAt_idx" ON "MemeSubmission"("channelId", "status", "createdAt" DESC);

CREATE INDEX "MemeSubmission_submitterUserId_status_createdAt_idx" ON "MemeSubmission"("submitterUserId", "status", "createdAt" DESC);

CREATE INDEX "MemeSubmission_submitterUserId_createdAt_idx" ON "MemeSubmission"("submitterUserId", "createdAt" DESC);

CREATE UNIQUE INDEX "Redemption_twitchRedemptionId_key" ON "Redemption"("twitchRedemptionId");

CREATE INDEX "Redemption_channelId_idx" ON "Redemption"("channelId");

CREATE INDEX "Redemption_userId_idx" ON "Redemption"("userId");

CREATE INDEX "Redemption_twitchRedemptionId_idx" ON "Redemption"("twitchRedemptionId");

CREATE INDEX "MemeActivation_channelMemeId_status_idx" ON "MemeActivation"("channelMemeId", "status");

CREATE INDEX "MemeActivation_userId_createdAt_idx" ON "MemeActivation"("userId", "createdAt");

CREATE INDEX "MemeActivation_channelId_createdAt_idx" ON "MemeActivation"("channelId", "createdAt");

CREATE INDEX "AuditLog_channelId_idx" ON "AuditLog"("channelId");

CREATE INDEX "AuditLog_actorId_idx" ON "AuditLog"("actorId");

CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

CREATE INDEX "ChannelMemeTag_tagId_idx" ON "ChannelMemeTag"("tagId");

CREATE UNIQUE INDEX "ChannelMemeTag_channelMemeId_tagId_key" ON "ChannelMemeTag"("channelMemeId", "tagId");
