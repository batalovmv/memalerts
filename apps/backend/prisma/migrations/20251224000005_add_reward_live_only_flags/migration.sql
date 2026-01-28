-- Add per-reward "only when live" flags to Channel settings.
ALTER TABLE "Channel"
ADD COLUMN IF NOT EXISTS "rewardOnlyWhenLive" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Channel"
ADD COLUMN IF NOT EXISTS "submissionRewardOnlyWhenLive" BOOLEAN NOT NULL DEFAULT false;


