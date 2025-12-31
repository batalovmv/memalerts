-- Add missing Kick reward settings columns to Channel (safe for shared DB / partially-migrated environments).
-- NOTE: Prisma expects these columns to exist because they are present in prisma/schema.prisma.

ALTER TABLE "Channel"
  ADD COLUMN IF NOT EXISTS "kickRewardEnabled" BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE "Channel"
  ADD COLUMN IF NOT EXISTS "kickRewardIdForCoins" TEXT;

ALTER TABLE "Channel"
  ADD COLUMN IF NOT EXISTS "kickCoinPerPointRatio" DOUBLE PRECISION NOT NULL DEFAULT 1.0;

ALTER TABLE "Channel"
  ADD COLUMN IF NOT EXISTS "kickRewardCoins" INTEGER;

ALTER TABLE "Channel"
  ADD COLUMN IF NOT EXISTS "kickRewardOnlyWhenLive" BOOLEAN NOT NULL DEFAULT FALSE;


