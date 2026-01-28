-- Add viewer submissions gate toggles to Channel
ALTER TABLE "Channel"
  ADD COLUMN IF NOT EXISTS "submissionsEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "submissionsOnlyWhenLive" BOOLEAN NOT NULL DEFAULT false;


