-- Favorites + blocklists (expand-only).

-- UserMemeFavorite
CREATE TABLE IF NOT EXISTS "UserMemeFavorite" (
  "id" TEXT PRIMARY KEY DEFAULT (gen_random_uuid()::text),
  "userId" TEXT NOT NULL,
  "channelId" TEXT NOT NULL,
  "memeAssetId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- UserMemeBlocklist
CREATE TABLE IF NOT EXISTS "UserMemeBlocklist" (
  "id" TEXT PRIMARY KEY DEFAULT (gen_random_uuid()::text),
  "userId" TEXT NOT NULL,
  "channelId" TEXT NOT NULL,
  "memeAssetId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ChannelMemeBlocklist
CREATE TABLE IF NOT EXISTS "ChannelMemeBlocklist" (
  "id" TEXT PRIMARY KEY DEFAULT (gen_random_uuid()::text),
  "channelId" TEXT NOT NULL,
  "memeAssetId" TEXT NOT NULL,
  "createdByUserId" TEXT,
  "reason" VARCHAR(500),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE UNIQUE INDEX IF NOT EXISTS "UserMemeFavorite_userId_channelId_memeAssetId_key" ON "UserMemeFavorite" ("userId", "channelId", "memeAssetId");
CREATE INDEX IF NOT EXISTS "UserMemeFavorite_userId_idx" ON "UserMemeFavorite" ("userId");
CREATE INDEX IF NOT EXISTS "UserMemeFavorite_channelId_idx" ON "UserMemeFavorite" ("channelId");
CREATE INDEX IF NOT EXISTS "UserMemeFavorite_memeAssetId_idx" ON "UserMemeFavorite" ("memeAssetId");
CREATE INDEX IF NOT EXISTS "UserMemeFavorite_channelId_userId_idx" ON "UserMemeFavorite" ("channelId", "userId");

CREATE UNIQUE INDEX IF NOT EXISTS "UserMemeBlocklist_userId_channelId_memeAssetId_key" ON "UserMemeBlocklist" ("userId", "channelId", "memeAssetId");
CREATE INDEX IF NOT EXISTS "UserMemeBlocklist_userId_idx" ON "UserMemeBlocklist" ("userId");
CREATE INDEX IF NOT EXISTS "UserMemeBlocklist_channelId_idx" ON "UserMemeBlocklist" ("channelId");
CREATE INDEX IF NOT EXISTS "UserMemeBlocklist_memeAssetId_idx" ON "UserMemeBlocklist" ("memeAssetId");
CREATE INDEX IF NOT EXISTS "UserMemeBlocklist_channelId_userId_idx" ON "UserMemeBlocklist" ("channelId", "userId");

CREATE UNIQUE INDEX IF NOT EXISTS "ChannelMemeBlocklist_channelId_memeAssetId_key" ON "ChannelMemeBlocklist" ("channelId", "memeAssetId");
CREATE INDEX IF NOT EXISTS "ChannelMemeBlocklist_channelId_idx" ON "ChannelMemeBlocklist" ("channelId");
CREATE INDEX IF NOT EXISTS "ChannelMemeBlocklist_memeAssetId_idx" ON "ChannelMemeBlocklist" ("memeAssetId");
CREATE INDEX IF NOT EXISTS "ChannelMemeBlocklist_createdByUserId_idx" ON "ChannelMemeBlocklist" ("createdByUserId");

-- Foreign keys (add once)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'UserMemeFavorite_userId_fkey') THEN
    ALTER TABLE "UserMemeFavorite"
      ADD CONSTRAINT "UserMemeFavorite_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'UserMemeFavorite_channelId_fkey') THEN
    ALTER TABLE "UserMemeFavorite"
      ADD CONSTRAINT "UserMemeFavorite_channelId_fkey"
      FOREIGN KEY ("channelId") REFERENCES "Channel"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'UserMemeFavorite_memeAssetId_fkey') THEN
    ALTER TABLE "UserMemeFavorite"
      ADD CONSTRAINT "UserMemeFavorite_memeAssetId_fkey"
      FOREIGN KEY ("memeAssetId") REFERENCES "MemeAsset"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'UserMemeBlocklist_userId_fkey') THEN
    ALTER TABLE "UserMemeBlocklist"
      ADD CONSTRAINT "UserMemeBlocklist_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'UserMemeBlocklist_channelId_fkey') THEN
    ALTER TABLE "UserMemeBlocklist"
      ADD CONSTRAINT "UserMemeBlocklist_channelId_fkey"
      FOREIGN KEY ("channelId") REFERENCES "Channel"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'UserMemeBlocklist_memeAssetId_fkey') THEN
    ALTER TABLE "UserMemeBlocklist"
      ADD CONSTRAINT "UserMemeBlocklist_memeAssetId_fkey"
      FOREIGN KEY ("memeAssetId") REFERENCES "MemeAsset"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ChannelMemeBlocklist_channelId_fkey') THEN
    ALTER TABLE "ChannelMemeBlocklist"
      ADD CONSTRAINT "ChannelMemeBlocklist_channelId_fkey"
      FOREIGN KEY ("channelId") REFERENCES "Channel"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ChannelMemeBlocklist_memeAssetId_fkey') THEN
    ALTER TABLE "ChannelMemeBlocklist"
      ADD CONSTRAINT "ChannelMemeBlocklist_memeAssetId_fkey"
      FOREIGN KEY ("memeAssetId") REFERENCES "MemeAsset"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ChannelMemeBlocklist_createdByUserId_fkey') THEN
    ALTER TABLE "ChannelMemeBlocklist"
      ADD CONSTRAINT "ChannelMemeBlocklist_createdByUserId_fkey"
      FOREIGN KEY ("createdByUserId") REFERENCES "User"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
