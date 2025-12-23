-- Add revision counter to MemeSubmission for "needs changes" resubmission flow
-- Created: 2025-12-23

ALTER TABLE "MemeSubmission"
ADD COLUMN IF NOT EXISTS "revision" INTEGER NOT NULL DEFAULT 0;


