-- Soft-delete support for Meme: additive, shared-DB safe.
ALTER TABLE "Meme"
  ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "Meme_deletedAt_idx" ON "Meme"("deletedAt");


