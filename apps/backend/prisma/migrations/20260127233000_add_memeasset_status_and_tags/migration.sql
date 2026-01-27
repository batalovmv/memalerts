-- Add MemeAsset status/timestamps + aiAutoTagNames array to match current schema.
-- Expand-only migration; safe for shared DBs.

ALTER TABLE "MemeAsset" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'active';
ALTER TABLE "MemeAsset" ADD COLUMN IF NOT EXISTS "hiddenAt" TIMESTAMP(3);
ALTER TABLE "MemeAsset" ADD COLUMN IF NOT EXISTS "quarantinedAt" TIMESTAMP(3);
ALTER TABLE "MemeAsset" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "MemeAsset" ADD COLUMN IF NOT EXISTS "aiAutoTagNames" TEXT[] NOT NULL DEFAULT '{}'::text[];
ALTER TABLE "MemeAsset" ADD COLUMN IF NOT EXISTS "aiRiskScore" DOUBLE PRECISION;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'MemeAsset'
      AND column_name = 'aiAutoTagNamesJson'
  ) THEN
    UPDATE "MemeAsset"
    SET "aiAutoTagNames" = (
      SELECT array_agg(elem)
      FROM jsonb_array_elements_text("aiAutoTagNamesJson") AS elem
    )
    WHERE "aiAutoTagNames" = '{}'::text[]
      AND "aiAutoTagNamesJson" IS NOT NULL
      AND jsonb_typeof("aiAutoTagNamesJson") = 'array';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "MemeAsset_status_idx" ON "MemeAsset"("status");
CREATE INDEX IF NOT EXISTS "MemeAsset_aiStatus_idx" ON "MemeAsset"("aiStatus");
