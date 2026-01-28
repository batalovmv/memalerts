-- CreateTable
CREATE TABLE "FileHash" (
    "hash" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "referenceCount" INTEGER NOT NULL DEFAULT 1,
    "fileSize" BIGINT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FileHash_pkey" PRIMARY KEY ("hash")
);

-- CreateIndex
CREATE INDEX "FileHash_referenceCount_idx" ON "FileHash"("referenceCount");

-- Legacy Meme table (if present)
DO $$
BEGIN
  IF to_regclass('"Meme"') IS NOT NULL THEN
    ALTER TABLE "Meme" ADD COLUMN IF NOT EXISTS "fileHash" TEXT;

    IF NOT EXISTS (
      SELECT 1 FROM pg_indexes WHERE indexname = 'Meme_fileHash_idx'
    ) THEN
      EXECUTE 'CREATE INDEX "Meme_fileHash_idx" ON "Meme"("fileHash")';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'Meme_fileHash_fkey'
    ) THEN
      ALTER TABLE "Meme"
        ADD CONSTRAINT "Meme_fileHash_fkey"
        FOREIGN KEY ("fileHash") REFERENCES "FileHash"("hash") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
  END IF;
END $$;


