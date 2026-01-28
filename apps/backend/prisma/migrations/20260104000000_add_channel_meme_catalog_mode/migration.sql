-- Add per-channel meme catalog mode (default: channel-only)
ALTER TABLE "Channel"
ADD COLUMN IF NOT EXISTS "memeCatalogMode" TEXT NOT NULL DEFAULT 'channel';


