-- AlterTable
ALTER TABLE "Channel" ADD COLUMN IF NOT EXISTS "defaultPriceCoins" INTEGER DEFAULT 100;

