-- Channel entitlements: feature flags / subscription gates.
-- Currently used for "custom_bot" gating: per-channel bot sender override.

CREATE TABLE IF NOT EXISTS "ChannelEntitlement" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "channelId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "expiresAt" TIMESTAMP(3),
  "source" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ChannelEntitlement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ChannelEntitlement_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "ChannelEntitlement_channelId_key_key" ON "ChannelEntitlement"("channelId","key");
CREATE INDEX IF NOT EXISTS "ChannelEntitlement_channelId_idx" ON "ChannelEntitlement"("channelId");
CREATE INDEX IF NOT EXISTS "ChannelEntitlement_key_enabled_idx" ON "ChannelEntitlement"("key","enabled");
CREATE INDEX IF NOT EXISTS "ChannelEntitlement_expiresAt_idx" ON "ChannelEntitlement"("expiresAt");


