-- Add idempotencyKey column to MemeActivation
ALTER TABLE "MemeActivation" ADD COLUMN IF NOT EXISTS "idempotencyKey" VARCHAR(128);

-- Add unique index for idempotency
CREATE UNIQUE INDEX "MemeActivation_channelId_userId_idempotencyKey_key"
ON "MemeActivation"("channelId", "userId", "idempotencyKey");

