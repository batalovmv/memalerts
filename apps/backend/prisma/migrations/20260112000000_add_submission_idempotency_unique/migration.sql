-- Add idempotency constraint for submissions
CREATE UNIQUE INDEX "MemeSubmission_channelId_memeAssetId_status_key"
ON "MemeSubmission"("channelId", "memeAssetId", "status");
