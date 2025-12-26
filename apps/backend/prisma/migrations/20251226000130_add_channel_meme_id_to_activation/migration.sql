-- Add ChannelMeme dimension to activations (expand-only).
-- Allows clients to send ChannelMeme.id while keeping legacy Meme.id for rollups/back-compat.

ALTER TABLE "MemeActivation"
  ADD COLUMN IF NOT EXISTS "channelMemeId" TEXT;

CREATE INDEX IF NOT EXISTS "MemeActivation_channelMemeId_idx" ON "MemeActivation"("channelMemeId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'MemeActivation_channelMemeId_fkey'
  ) THEN
    ALTER TABLE "MemeActivation"
      ADD CONSTRAINT "MemeActivation_channelMemeId_fkey"
      FOREIGN KEY ("channelMemeId") REFERENCES "ChannelMeme"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;


