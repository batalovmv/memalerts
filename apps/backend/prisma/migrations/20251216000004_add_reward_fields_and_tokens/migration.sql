-- AlterTable
ALTER TABLE "Channel" ADD COLUMN "rewardEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "rewardTitle" TEXT,
ADD COLUMN "rewardCost" INTEGER,
ADD COLUMN "rewardCoins" INTEGER;

-- AlterTable
ALTER TABLE "User" ADD COLUMN "twitchAccessToken" TEXT,
ADD COLUMN "twitchRefreshToken" TEXT;


