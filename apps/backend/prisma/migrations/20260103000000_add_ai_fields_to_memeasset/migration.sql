-- Add global AI metadata to MemeAsset (pool-level, reusable across channels).
ALTER TABLE "MemeAsset"
  ADD COLUMN IF NOT EXISTS "aiStatus" TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS "aiAutoTagNamesJson" JSONB,
  ADD COLUMN IF NOT EXISTS "aiAutoDescription" VARCHAR(2000),
  ADD COLUMN IF NOT EXISTS "aiSearchText" VARCHAR(4000),
  ADD COLUMN IF NOT EXISTS "aiCompletedAt" TIMESTAMP(3);


