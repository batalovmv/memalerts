-- Add Kick event subscription id to Channel
ALTER TABLE "Channel" ADD COLUMN IF NOT EXISTS "kickRewardsSubscriptionId" TEXT;

-- Some DBs may have been bootstrapped via `prisma db push` / partial migrations.
-- Ensure Prisma enum type exists before referencing it.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE t.typname = 'ExternalRewardProvider' AND n.nspname = 'public'
    ) THEN
        CREATE TYPE "ExternalRewardProvider" AS ENUM ('kick', 'trovo', 'vkvideo');
    END IF;
END $$;

-- Delivery-level dedupe for external webhooks (Kick retries, etc.)
CREATE TABLE IF NOT EXISTS "ExternalWebhookDeliveryDedup" (
    "id" TEXT NOT NULL,
    "provider" "ExternalRewardProvider" NOT NULL,
    "messageId" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "externalEventId" TEXT,

    CONSTRAINT "ExternalWebhookDeliveryDedup_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ExternalWebhookDeliveryDedup_provider_messageId_key"
ON "ExternalWebhookDeliveryDedup"("provider", "messageId");

CREATE INDEX IF NOT EXISTS "ExternalWebhookDeliveryDedup_receivedAt_idx"
ON "ExternalWebhookDeliveryDedup"("receivedAt");

ALTER TABLE "ExternalWebhookDeliveryDedup"
ADD CONSTRAINT "ExternalWebhookDeliveryDedup_externalEventId_fkey"
FOREIGN KEY ("externalEventId") REFERENCES "ExternalRewardEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;


