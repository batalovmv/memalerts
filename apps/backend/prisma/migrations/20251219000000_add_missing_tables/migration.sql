-- CreateTable
CREATE TABLE IF NOT EXISTS "Tag" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "MemeTag" (
    "id" TEXT NOT NULL,
    "memeId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    CONSTRAINT "MemeTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "MemeSubmissionTag" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    CONSTRAINT "MemeSubmissionTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Promotion" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "discountPercent" DOUBLE PRECISION NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Promotion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Tag_name_key" ON "Tag"("name");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Tag_name_idx" ON "Tag"("name");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "MemeTag_memeId_tagId_key" ON "MemeTag"("memeId", "tagId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "MemeTag_memeId_idx" ON "MemeTag"("memeId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "MemeTag_tagId_idx" ON "MemeTag"("tagId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "MemeSubmissionTag_submissionId_tagId_key" ON "MemeSubmissionTag"("submissionId", "tagId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "MemeSubmissionTag_submissionId_idx" ON "MemeSubmissionTag"("submissionId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "MemeSubmissionTag_tagId_idx" ON "MemeSubmissionTag"("tagId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Promotion_channelId_idx" ON "Promotion"("channelId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Promotion_isActive_idx" ON "Promotion"("isActive");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Promotion_startDate_endDate_idx" ON "Promotion"("startDate", "endDate");

-- AddForeignKey
ALTER TABLE "MemeTag" ADD CONSTRAINT "MemeTag_memeId_fkey" FOREIGN KEY ("memeId") REFERENCES "Meme"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemeTag" ADD CONSTRAINT "MemeTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemeSubmissionTag" ADD CONSTRAINT "MemeSubmissionTag_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "MemeSubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemeSubmissionTag" ADD CONSTRAINT "MemeSubmissionTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Promotion" ADD CONSTRAINT "Promotion_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Add constraints from existing migration if they don't exist
DO $$
BEGIN
    -- Promotion constraints: discount must be between 0 and 100
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'promotion_discount_range'
    ) THEN
        ALTER TABLE "Promotion" 
        ADD CONSTRAINT "promotion_discount_range" 
        CHECK ("discountPercent" >= 0 AND "discountPercent" <= 100);
    END IF;

    -- Promotion constraints: end date must be after start date
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'promotion_date_range'
    ) THEN
        ALTER TABLE "Promotion" 
        ADD CONSTRAINT "promotion_date_range" 
        CHECK ("endDate" > "startDate");
    END IF;
END $$;

