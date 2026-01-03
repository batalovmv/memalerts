-- Playback audio normalization (site + OBS) and playFileUrl.
ALTER TABLE "MemeAsset"
ADD COLUMN "playFileUrl" TEXT,
ADD COLUMN "audioNormStatus" TEXT NOT NULL DEFAULT 'pending',
ADD COLUMN "audioNormRetryCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "audioNormLastTriedAt" TIMESTAMP(3),
ADD COLUMN "audioNormNextRetryAt" TIMESTAMP(3),
ADD COLUMN "audioNormError" TEXT,
ADD COLUMN "audioNormCompletedAt" TIMESTAMP(3);


