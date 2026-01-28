-- Soft-delete support for Meme: additive, shared-DB safe.
DO $$
BEGIN
  IF to_regclass('"Meme"') IS NOT NULL THEN
    ALTER TABLE "Meme"
      ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);

    IF NOT EXISTS (
      SELECT 1 FROM pg_indexes WHERE indexname = 'Meme_deletedAt_idx'
    ) THEN
      EXECUTE 'CREATE INDEX "Meme_deletedAt_idx" ON "Meme"("deletedAt")';
    END IF;
  END IF;
END $$;


