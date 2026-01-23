-- Add contentHash for perceptual deduplication (versioned: "v1:<sha256>")
ALTER TABLE "MemeAsset" ADD COLUMN "contentHash" VARCHAR(70);

-- Index for lookups
CREATE INDEX "MemeAsset_contentHash_idx" ON "MemeAsset"("contentHash");

-- Unique partial index to protect against race conditions
CREATE UNIQUE INDEX "MemeAsset_contentHash_unique" ON "MemeAsset"("contentHash") WHERE "contentHash" IS NOT NULL;
