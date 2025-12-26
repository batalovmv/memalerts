-- Add global meme pool normalization: MemeAsset (global) + ChannelMeme (channel adoption).
-- Expand-only migration: additive and shared-DB safe.

CREATE TABLE IF NOT EXISTS "MemeAsset" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "type" TEXT NOT NULL,
  "fileUrl" TEXT,
  "fileHash" TEXT,
  "durationMs" INTEGER NOT NULL,

  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  "poolVisibility" TEXT NOT NULL DEFAULT 'visible',
  "poolHiddenAt" TIMESTAMP(3),
  "poolHiddenReason" TEXT,
  "poolHiddenByUserId" TEXT,

  "purgeRequestedAt" TIMESTAMP(3),
  "purgeNotBefore" TIMESTAMP(3),
  "purgedAt" TIMESTAMP(3),
  "purgeReason" TEXT,
  "purgeByUserId" TEXT,

  CONSTRAINT "MemeAsset_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MemeAsset_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "MemeAsset_poolHiddenByUserId_fkey" FOREIGN KEY ("poolHiddenByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "MemeAsset_purgeByUserId_fkey" FOREIGN KEY ("purgeByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "MemeAsset_fileHash_fkey" FOREIGN KEY ("fileHash") REFERENCES "FileHash"("hash") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "MemeAsset_fileHash_idx" ON "MemeAsset"("fileHash");
CREATE INDEX IF NOT EXISTS "MemeAsset_createdByUserId_idx" ON "MemeAsset"("createdByUserId");
CREATE INDEX IF NOT EXISTS "MemeAsset_poolVisibility_idx" ON "MemeAsset"("poolVisibility");
CREATE INDEX IF NOT EXISTS "MemeAsset_poolHiddenAt_idx" ON "MemeAsset"("poolHiddenAt");
CREATE INDEX IF NOT EXISTS "MemeAsset_purgeNotBefore_idx" ON "MemeAsset"("purgeNotBefore");
CREATE INDEX IF NOT EXISTS "MemeAsset_purgedAt_idx" ON "MemeAsset"("purgedAt");
CREATE INDEX IF NOT EXISTS "MemeAsset_createdAt_idx" ON "MemeAsset"("createdAt");

CREATE TABLE IF NOT EXISTS "ChannelMeme" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "channelId" TEXT NOT NULL,
  "memeAssetId" TEXT NOT NULL,
  "legacyMemeId" TEXT,

  "status" TEXT NOT NULL DEFAULT 'approved',
  "deletedAt" TIMESTAMP(3),

  "title" TEXT NOT NULL,
  "priceCoins" INTEGER NOT NULL,

  "addedByUserId" TEXT,
  "approvedByUserId" TEXT,
  "approvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ChannelMeme_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ChannelMeme_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ChannelMeme_memeAssetId_fkey" FOREIGN KEY ("memeAssetId") REFERENCES "MemeAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ChannelMeme_addedByUserId_fkey" FOREIGN KEY ("addedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "ChannelMeme_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "ChannelMeme_channelId_memeAssetId_key" ON "ChannelMeme"("channelId","memeAssetId");
CREATE INDEX IF NOT EXISTS "ChannelMeme_channelId_idx" ON "ChannelMeme"("channelId");
CREATE INDEX IF NOT EXISTS "ChannelMeme_memeAssetId_idx" ON "ChannelMeme"("memeAssetId");
CREATE INDEX IF NOT EXISTS "ChannelMeme_legacyMemeId_idx" ON "ChannelMeme"("legacyMemeId");
CREATE INDEX IF NOT EXISTS "ChannelMeme_status_idx" ON "ChannelMeme"("status");
CREATE INDEX IF NOT EXISTS "ChannelMeme_deletedAt_idx" ON "ChannelMeme"("deletedAt");
CREATE INDEX IF NOT EXISTS "ChannelMeme_channelId_status_createdAt_idx" ON "ChannelMeme"("channelId","status","createdAt");


