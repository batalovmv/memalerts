-- Add per-reward "only when live" flags to Channel settings.
ALTER TABLE "Channel"
ADD COLUMN "rewardOnlyWhenLive" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Channel"
ADD COLUMN "submissionRewardOnlyWhenLive" BOOLEAN NOT NULL DEFAULT false;


