-- Add Kick event subscription id to Channel
ALTER TABLE "Channel" ADD COLUMN IF NOT EXISTS "kickRewardsSubscriptionId" TEXT;

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


