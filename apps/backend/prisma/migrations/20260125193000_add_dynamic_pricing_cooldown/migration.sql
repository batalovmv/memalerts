-- Add dynamic pricing settings to Channel
ALTER TABLE "Channel"
  ADD COLUMN IF NOT EXISTS "dynamicPricingEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "dynamicPricingMinMult" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  ADD COLUMN IF NOT EXISTS "dynamicPricingMaxMult" DOUBLE PRECISION NOT NULL DEFAULT 2.0;

-- Add smart cooldown to ChannelMeme
ALTER TABLE "ChannelMeme"
  ADD COLUMN IF NOT EXISTS "cooldownMinutes" INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "lastActivatedAt" TIMESTAMP(3);
