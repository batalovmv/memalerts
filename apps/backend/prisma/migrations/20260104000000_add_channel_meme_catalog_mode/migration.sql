-- Add per-channel meme catalog mode (default: channel-only)
ALTER TABLE "Channel"
ADD COLUMN "memeCatalogMode" TEXT NOT NULL DEFAULT 'channel';


