-- Add ChannelMeme dimension to activations (expand-only).
-- Allows clients to send ChannelMeme.id while keeping legacy Meme.id for rollups/back-compat.

ALTER TABLE "MemeActivation"
  ADD COLUMN IF NOT EXISTS "channelMemeId" TEXT;

CREATE INDEX IF NOT EXISTS "MemeActivation_channelMemeId_idx" ON "MemeActivation"("channelMemeId");

ALTER TABLE "MemeActivation"
  ADD CONSTRAINT IF NOT EXISTS "MemeActivation_channelMemeId_fkey"
  FOREIGN KEY ("channelMemeId") REFERENCES "ChannelMeme"("id") ON DELETE SET NULL ON UPDATE CASCADE;


