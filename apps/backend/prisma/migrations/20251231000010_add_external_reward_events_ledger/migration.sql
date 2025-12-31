-- External rewards ledger (Kick/Trovo/VKVideo) + pending grants.
-- Some environments (beta/prod) may have been bootstrapped via `prisma db push`,
-- so we create enums/tables defensively.

-- Enums
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE t.typname = 'ExternalRewardProvider' AND n.nspname = 'public'
    ) THEN
        CREATE TYPE "ExternalRewardProvider" AS ENUM ('kick', 'trovo', 'vkvideo');
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE t.typname = 'ExternalRewardEventType' AND n.nspname = 'public'
    ) THEN
        CREATE TYPE "ExternalRewardEventType" AS ENUM ('kick_reward_redemption', 'trovo_spell', 'vkvideo_channel_points_redemption');
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE t.typname = 'ExternalRewardCurrency' AND n.nspname = 'public'
    ) THEN
        CREATE TYPE "ExternalRewardCurrency" AS ENUM ('kick_channel_points', 'trovo_mana', 'trovo_elixir', 'vkvideo_channel_points');
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE t.typname = 'ExternalRewardEventStatus' AND n.nspname = 'public'
    ) THEN
        CREATE TYPE "ExternalRewardEventStatus" AS ENUM ('observed', 'eligible', 'ignored', 'claimed', 'failed');
    END IF;
END $$;

-- ExternalRewardEvent
CREATE TABLE IF NOT EXISTS "ExternalRewardEvent" (
    "id" TEXT NOT NULL,
    "provider" "ExternalRewardProvider" NOT NULL,
    "providerEventId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "eventType" "ExternalRewardEventType" NOT NULL,
    "eventAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "currency" "ExternalRewardCurrency" NOT NULL,
    "amount" INTEGER NOT NULL,
    "status" "ExternalRewardEventStatus" NOT NULL DEFAULT 'observed',
    "reason" TEXT,
    "rawPayloadJson" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalRewardEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ExternalRewardEvent_provider_providerEventId_key"
ON "ExternalRewardEvent"("provider", "providerEventId");

CREATE INDEX IF NOT EXISTS "ExternalRewardEvent_channelId_idx" ON "ExternalRewardEvent"("channelId");
CREATE INDEX IF NOT EXISTS "ExternalRewardEvent_provider_providerAccountId_idx" ON "ExternalRewardEvent"("provider", "providerAccountId");
CREATE INDEX IF NOT EXISTS "ExternalRewardEvent_provider_status_idx" ON "ExternalRewardEvent"("provider", "status");
CREATE INDEX IF NOT EXISTS "ExternalRewardEvent_eventAt_idx" ON "ExternalRewardEvent"("eventAt");
CREATE INDEX IF NOT EXISTS "ExternalRewardEvent_receivedAt_idx" ON "ExternalRewardEvent"("receivedAt");

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ExternalRewardEvent_channelId_fkey') THEN
        ALTER TABLE "ExternalRewardEvent"
        ADD CONSTRAINT "ExternalRewardEvent_channelId_fkey"
        FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- PendingCoinGrant
CREATE TABLE IF NOT EXISTS "PendingCoinGrant" (
    "id" TEXT NOT NULL,
    "provider" "ExternalRewardProvider" NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "externalEventId" TEXT NOT NULL,
    "coinsToGrant" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimedAt" TIMESTAMP(3),
    "claimedByUserId" TEXT,

    CONSTRAINT "PendingCoinGrant_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PendingCoinGrant_externalEventId_key" ON "PendingCoinGrant"("externalEventId");
CREATE INDEX IF NOT EXISTS "PendingCoinGrant_provider_providerAccountId_idx" ON "PendingCoinGrant"("provider", "providerAccountId");
CREATE INDEX IF NOT EXISTS "PendingCoinGrant_channelId_idx" ON "PendingCoinGrant"("channelId");
CREATE INDEX IF NOT EXISTS "PendingCoinGrant_claimedAt_idx" ON "PendingCoinGrant"("claimedAt");
CREATE INDEX IF NOT EXISTS "PendingCoinGrant_provider_providerAccountId_claimedAt_idx" ON "PendingCoinGrant"("provider", "providerAccountId", "claimedAt");

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PendingCoinGrant_channelId_fkey') THEN
        ALTER TABLE "PendingCoinGrant"
        ADD CONSTRAINT "PendingCoinGrant_channelId_fkey"
        FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PendingCoinGrant_claimedByUserId_fkey') THEN
        ALTER TABLE "PendingCoinGrant"
        ADD CONSTRAINT "PendingCoinGrant_claimedByUserId_fkey"
        FOREIGN KEY ("claimedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PendingCoinGrant_externalEventId_fkey') THEN
        ALTER TABLE "PendingCoinGrant"
        ADD CONSTRAINT "PendingCoinGrant_externalEventId_fkey"
        FOREIGN KEY ("externalEventId") REFERENCES "ExternalRewardEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;


