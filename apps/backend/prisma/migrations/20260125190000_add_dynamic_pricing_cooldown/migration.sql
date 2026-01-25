-- Dynamic pricing fields (expand-only).
ALTER TABLE "Channel"
  ADD COLUMN IF NOT EXISTS "dynamicPricingEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Channel"
  ADD COLUMN IF NOT EXISTS "dynamicPricingMinMult" DOUBLE PRECISION NOT NULL DEFAULT 0.5;
ALTER TABLE "Channel"
  ADD COLUMN IF NOT EXISTS "dynamicPricingMaxMult" DOUBLE PRECISION NOT NULL DEFAULT 2.0;

-- Smart cooldown fields.
ALTER TABLE "ChannelMeme"
  ADD COLUMN IF NOT EXISTS "cooldownMinutes" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ChannelMeme"
  ADD COLUMN IF NOT EXISTS "lastActivatedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "ChannelMeme_lastActivatedAt_idx" ON "ChannelMeme" ("lastActivatedAt");
