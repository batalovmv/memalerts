-- Add per-channel streamer dashboard card order (cross-device UI layout).
-- Nullable: null means "use frontend default order".

ALTER TABLE "Channel"
ADD COLUMN "dashboardCardOrder" jsonb;


