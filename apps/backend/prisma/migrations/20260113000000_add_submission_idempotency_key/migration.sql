-- Add idempotency key for submissions
ALTER TABLE "MemeSubmission" ADD COLUMN IF NOT EXISTS "idempotencyKey" VARCHAR(128);

CREATE UNIQUE INDEX "MemeSubmission_channelId_submitterUserId_idempotencyKey_key"
ON "MemeSubmission"("channelId", "submitterUserId", "idempotencyKey");
