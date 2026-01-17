-- AI moderation lock fields for MemeSubmission (expand-only, safe for shared DB).
-- Use IF NOT EXISTS to be resilient across environments.

ALTER TABLE "MemeSubmission"
  ADD COLUMN IF NOT EXISTS "aiProcessingStartedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "aiLockedBy" VARCHAR(128),
  ADD COLUMN IF NOT EXISTS "aiLockExpiresAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "MemeSubmission_aiStatus_aiLockExpiresAt_idx"
  ON "MemeSubmission" ("aiStatus", "aiLockExpiresAt");