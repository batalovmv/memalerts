-- VKVideo channel points -> coins: per-channel reward configuration.
-- Safe for environments where schema might already be partially applied (prod/beta shared DB / db push).

ALTER TABLE "Channel"
  ADD COLUMN IF NOT EXISTS "vkvideoRewardEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "vkvideoRewardIdForCoins" TEXT,
  ADD COLUMN IF NOT EXISTS "vkvideoCoinPerPointRatio" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS "vkvideoRewardCoins" INTEGER,
  ADD COLUMN IF NOT EXISTS "vkvideoRewardOnlyWhenLive" BOOLEAN NOT NULL DEFAULT false;


