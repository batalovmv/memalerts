-- Add per-channel reward for approved meme submissions
ALTER TABLE "Channel"
ADD COLUMN "submissionRewardCoins" INTEGER NOT NULL DEFAULT 0;


