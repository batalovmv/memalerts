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

-- AlterTable
ALTER TABLE "Meme" ADD COLUMN "fileHash" TEXT;

-- CreateIndex
CREATE INDEX "Meme_fileHash_idx" ON "Meme"("fileHash");

-- AddForeignKey
ALTER TABLE "Meme" ADD CONSTRAINT "Meme_fileHash_fkey" FOREIGN KEY ("fileHash") REFERENCES "FileHash"("hash") ON DELETE SET NULL ON UPDATE CASCADE;


