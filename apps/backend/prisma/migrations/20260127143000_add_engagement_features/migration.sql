-- Add wheel settings to Channel
ALTER TABLE "Channel" ADD COLUMN IF NOT EXISTS "wheelEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Channel" ADD COLUMN IF NOT EXISTS "wheelPaidSpinCostCoins" INTEGER;
ALTER TABLE "Channel" ADD COLUMN IF NOT EXISTS "wheelPrizeMultiplier" DOUBLE PRECISION NOT NULL DEFAULT 1.0;

-- Add streak and wheel tracking to ChannelViewerEconomy
ALTER TABLE "ChannelViewerEconomy" ADD COLUMN "loginStreakLastClaimAt" TIMESTAMP(3);
ALTER TABLE "ChannelViewerEconomy" ADD COLUMN "loginStreakCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ChannelViewerEconomy" ADD COLUMN "wheelFreeSpinLastAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "ChannelViewerEconomy_loginStreakLastClaimAt_idx" ON "ChannelViewerEconomy"("loginStreakLastClaimAt");
CREATE INDEX IF NOT EXISTS "ChannelViewerEconomy_wheelFreeSpinLastAt_idx" ON "ChannelViewerEconomy"("wheelFreeSpinLastAt");

-- Timing bonus tracking on ChannelMeme
ALTER TABLE "ChannelMeme" ADD COLUMN "timingBonusLastAt" TIMESTAMP(3);

-- Vote sessions
CREATE TABLE IF NOT EXISTS "MemeVoteSession" (
  "id" TEXT NOT NULL,
  "channelId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endsAt" TIMESTAMP(3),
  "endedAt" TIMESTAMP(3),
  "createdByUserId" TEXT,
  "winnerChannelMemeId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "MemeVoteSession_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "MemeVoteSession_channelId_status_idx" ON "MemeVoteSession"("channelId", "status");
CREATE INDEX IF NOT EXISTS "MemeVoteSession_startedAt_idx" ON "MemeVoteSession"("startedAt");
CREATE INDEX IF NOT EXISTS "MemeVoteSession_endsAt_idx" ON "MemeVoteSession"("endsAt");

ALTER TABLE "MemeVoteSession" ADD CONSTRAINT "MemeVoteSession_channelId_fkey"
  FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MemeVoteSession" ADD CONSTRAINT "MemeVoteSession_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MemeVoteSession" ADD CONSTRAINT "MemeVoteSession_winnerChannelMemeId_fkey"
  FOREIGN KEY ("winnerChannelMemeId") REFERENCES "ChannelMeme"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "MemeVoteOption" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "channelMemeId" TEXT NOT NULL,
  "optionIndex" INTEGER NOT NULL,

  CONSTRAINT "MemeVoteOption_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "MemeVoteOption_sessionId_optionIndex_key" ON "MemeVoteOption"("sessionId", "optionIndex");
CREATE INDEX IF NOT EXISTS "MemeVoteOption_sessionId_idx" ON "MemeVoteOption"("sessionId");
CREATE INDEX IF NOT EXISTS "MemeVoteOption_channelMemeId_idx" ON "MemeVoteOption"("channelMemeId");

ALTER TABLE "MemeVoteOption" ADD CONSTRAINT "MemeVoteOption_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "MemeVoteSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MemeVoteOption" ADD CONSTRAINT "MemeVoteOption_channelMemeId_fkey"
  FOREIGN KEY ("channelMemeId") REFERENCES "ChannelMeme"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "MemeVoteBallot" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "channelMemeId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "MemeVoteBallot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "MemeVoteBallot_sessionId_userId_key" ON "MemeVoteBallot"("sessionId", "userId");
CREATE INDEX IF NOT EXISTS "MemeVoteBallot_sessionId_idx" ON "MemeVoteBallot"("sessionId");
CREATE INDEX IF NOT EXISTS "MemeVoteBallot_channelMemeId_idx" ON "MemeVoteBallot"("channelMemeId");

ALTER TABLE "MemeVoteBallot" ADD CONSTRAINT "MemeVoteBallot_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "MemeVoteSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MemeVoteBallot" ADD CONSTRAINT "MemeVoteBallot_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MemeVoteBallot" ADD CONSTRAINT "MemeVoteBallot_channelMemeId_fkey"
  FOREIGN KEY ("channelMemeId") REFERENCES "ChannelMeme"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Wheel spins
CREATE TABLE IF NOT EXISTS "WheelSpin" (
  "id" TEXT NOT NULL,
  "channelId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "isFree" BOOLEAN NOT NULL DEFAULT false,
  "costCoins" INTEGER NOT NULL DEFAULT 0,
  "prizeTier" TEXT NOT NULL,
  "prizeCoins" INTEGER NOT NULL,
  "prizeLabel" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "WheelSpin_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "WheelSpin_channelId_createdAt_idx" ON "WheelSpin"("channelId", "createdAt");
CREATE INDEX IF NOT EXISTS "WheelSpin_userId_createdAt_idx" ON "WheelSpin"("userId", "createdAt");

ALTER TABLE "WheelSpin" ADD CONSTRAINT "WheelSpin_channelId_fkey"
  FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WheelSpin" ADD CONSTRAINT "WheelSpin_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Submission approval streaks
CREATE TABLE IF NOT EXISTS "ChannelSubmissionStreak" (
  "id" TEXT NOT NULL,
  "channelId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "streakCount" INTEGER NOT NULL DEFAULT 0,
  "lastApprovedAt" TIMESTAMP(3),
  "lastRejectedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ChannelSubmissionStreak_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ChannelSubmissionStreak_channelId_userId_key" ON "ChannelSubmissionStreak"("channelId", "userId");
CREATE INDEX IF NOT EXISTS "ChannelSubmissionStreak_channelId_idx" ON "ChannelSubmissionStreak"("channelId");
CREATE INDEX IF NOT EXISTS "ChannelSubmissionStreak_userId_idx" ON "ChannelSubmissionStreak"("userId");

ALTER TABLE "ChannelSubmissionStreak" ADD CONSTRAINT "ChannelSubmissionStreak_channelId_fkey"
  FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChannelSubmissionStreak" ADD CONSTRAINT "ChannelSubmissionStreak_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Viral bonus tracking
CREATE TABLE IF NOT EXISTS "MemeViralBonus" (
  "id" TEXT NOT NULL,
  "channelMemeId" TEXT NOT NULL,
  "threshold" INTEGER NOT NULL,
  "awardedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "MemeViralBonus_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "MemeViralBonus_channelMemeId_threshold_key" ON "MemeViralBonus"("channelMemeId", "threshold");
CREATE INDEX IF NOT EXISTS "MemeViralBonus_channelMemeId_idx" ON "MemeViralBonus"("channelMemeId");

ALTER TABLE "MemeViralBonus" ADD CONSTRAINT "MemeViralBonus_channelMemeId_fkey"
  FOREIGN KEY ("channelMemeId") REFERENCES "ChannelMeme"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seasonal events
CREATE TABLE IF NOT EXISTS "SeasonalEvent" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3) NOT NULL,
  "themeJson" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SeasonalEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SeasonalEvent_key_key" ON "SeasonalEvent"("key");
CREATE INDEX IF NOT EXISTS "SeasonalEvent_startsAt_endsAt_idx" ON "SeasonalEvent"("startsAt", "endsAt");
