-- Add overlay token rotation version to Channel
ALTER TABLE "Channel"
  ADD COLUMN IF NOT EXISTS "overlayTokenVersion" INTEGER NOT NULL DEFAULT 1;



