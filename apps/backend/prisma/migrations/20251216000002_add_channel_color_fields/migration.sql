-- AlterTable
ALTER TABLE "Channel" ADD COLUMN IF NOT EXISTS "primaryColor" TEXT,
ADD COLUMN IF NOT EXISTS "secondaryColor" TEXT,
ADD COLUMN IF NOT EXISTS "accentColor" TEXT;


