-- Add per-channel settings for the "smart" chat command: stream duration.
-- Additive migration (safe for shared DB / expand step).

ALTER TABLE "Channel"
  ADD COLUMN IF NOT EXISTS "streamDurationCommandJson" TEXT;





