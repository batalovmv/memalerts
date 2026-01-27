-- Add missing MemeAsset/MemeActivation columns required by current Prisma schema.
-- Expand-only migration; safe for shared DBs.

ALTER TABLE "MemeAsset" ADD COLUMN IF NOT EXISTS "qualityScore" DOUBLE PRECISION;
ALTER TABLE "MemeAsset" ADD COLUMN IF NOT EXISTS "createdById" TEXT;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'MemeAsset'
      AND column_name = 'createdByUserId'
  ) THEN
    UPDATE "MemeAsset"
    SET "createdById" = COALESCE("createdById", "createdByUserId")
    WHERE "createdById" IS NULL
      AND "createdByUserId" IS NOT NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'MemeAsset_createdById_fkey'
  ) THEN
    ALTER TABLE "MemeAsset"
      ADD CONSTRAINT "MemeAsset_createdById_fkey"
      FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "MemeAsset_qualityScore_idx" ON "MemeAsset"("qualityScore");

ALTER TABLE "MemeActivation" ADD COLUMN IF NOT EXISTS "priceCoins" INTEGER;

UPDATE "MemeActivation" AS ma
SET "priceCoins" = cm."priceCoins"
FROM "ChannelMeme" AS cm
WHERE ma."priceCoins" IS NULL
  AND ma."channelMemeId" = cm."id";

UPDATE "MemeActivation"
SET "priceCoins" = 100
WHERE "priceCoins" IS NULL;

ALTER TABLE "MemeActivation" ALTER COLUMN "priceCoins" SET NOT NULL;
