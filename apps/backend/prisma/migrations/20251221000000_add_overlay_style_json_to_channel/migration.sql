-- Add advanced overlay style settings (stored as JSON string)
ALTER TABLE "Channel"
ADD COLUMN IF NOT EXISTS "overlayStyleJson" TEXT;


