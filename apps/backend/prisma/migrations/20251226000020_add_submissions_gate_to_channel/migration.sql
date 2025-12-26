-- Add viewer submissions gate toggles to Channel
ALTER TABLE "Channel"
  ADD COLUMN "submissionsEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "submissionsOnlyWhenLive" BOOLEAN NOT NULL DEFAULT false;


