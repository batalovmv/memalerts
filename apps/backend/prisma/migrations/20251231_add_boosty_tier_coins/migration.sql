-- Add Boosty tier->coins mapping per channel (boosty_api mode)
ALTER TABLE "Channel"
ADD COLUMN IF NOT EXISTS "boostyTierCoinsJson" JSONB;

-- Track last granted tier key to support tier upgrades via delta
ALTER TABLE "BoostySubscriptionReward"
ADD COLUMN IF NOT EXISTS "boostyTierKey" TEXT;

-- Track updates (used by UI/admin debugging and to verify delta logic in prod)
ALTER TABLE "BoostySubscriptionReward"
ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Make granted coins explicit (so scheduler never depends on current tier->coins config).
ALTER TABLE "BoostySubscriptionReward"
ALTER COLUMN "coinsGranted" SET DEFAULT 0;

-- Safety for older rows / legacy migrations: avoid NULL granted coins.
UPDATE "BoostySubscriptionReward" SET "coinsGranted" = 0 WHERE "coinsGranted" IS NULL;

-- Enforce NOT NULL (Prisma schema expects Int, not Int?).
ALTER TABLE "BoostySubscriptionReward"
ALTER COLUMN "coinsGranted" SET NOT NULL;


