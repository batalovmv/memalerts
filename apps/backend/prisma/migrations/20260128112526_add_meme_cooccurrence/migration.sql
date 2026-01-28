-- CreateTable
CREATE TABLE "MemeCooccurrence" (
    "id" TEXT NOT NULL,
    "memeAssetId1" TEXT NOT NULL,
    "memeAssetId2" TEXT NOT NULL,
    "cooccurrences" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MemeCooccurrence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MemeCooccurrence_memeAssetId1_idx" ON "MemeCooccurrence"("memeAssetId1");

-- CreateIndex
CREATE INDEX "MemeCooccurrence_memeAssetId2_idx" ON "MemeCooccurrence"("memeAssetId2");

-- CreateIndex
CREATE INDEX "MemeCooccurrence_cooccurrences_idx" ON "MemeCooccurrence"("cooccurrences");

-- CreateIndex
CREATE UNIQUE INDEX "MemeCooccurrence_memeAssetId1_memeAssetId2_key" ON "MemeCooccurrence"("memeAssetId1", "memeAssetId2");

-- AddForeignKey
ALTER TABLE "MemeCooccurrence" ADD CONSTRAINT "MemeCooccurrence_memeAssetId1_fkey" FOREIGN KEY ("memeAssetId1") REFERENCES "MemeAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemeCooccurrence" ADD CONSTRAINT "MemeCooccurrence_memeAssetId2_fkey" FOREIGN KEY ("memeAssetId2") REFERENCES "MemeAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
