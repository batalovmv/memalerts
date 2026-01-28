-- Add per-channel Discord guild id for Boosty subscription rewards via Discord roles.
ALTER TABLE "Channel"
ADD COLUMN IF NOT EXISTS "discordSubscriptionsGuildId" TEXT;


