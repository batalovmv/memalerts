-- Pool submission + reward split (expand-only).
-- Add separate reward amounts for submission sources (upload/url vs pool import).

ALTER TABLE "Channel"
  ADD COLUMN IF NOT EXISTS "submissionRewardCoinsUpload" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "Channel"
  ADD COLUMN IF NOT EXISTS "submissionRewardCoinsPool" INTEGER NOT NULL DEFAULT 100;

-- Backfill: preserve existing behavior by copying legacy submissionRewardCoins into new Upload reward if still 0.
UPDATE "Channel"
SET "submissionRewardCoinsUpload" = "submissionRewardCoins"
WHERE "submissionRewardCoinsUpload" = 0;

-- MemeSubmission: support pool import
ALTER TABLE "MemeSubmission"
  ADD COLUMN IF NOT EXISTS "memeAssetId" TEXT;

ALTER TABLE "MemeSubmission"
  ADD COLUMN IF NOT EXISTS "sourceKind" TEXT NOT NULL DEFAULT 'upload';

CREATE INDEX IF NOT EXISTS "MemeSubmission_memeAssetId_idx" ON "MemeSubmission"("memeAssetId");
CREATE INDEX IF NOT EXISTS "MemeSubmission_sourceKind_idx" ON "MemeSubmission"("sourceKind");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'MemeSubmission_memeAssetId_fkey'
  ) THEN
    ALTER TABLE "MemeSubmission"
      ADD CONSTRAINT "MemeSubmission_memeAssetId_fkey"
      FOREIGN KEY ("memeAssetId") REFERENCES "MemeAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;


