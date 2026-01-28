-- Public control token for StreamDeck/StreamerBot integrations.
-- Store only a SHA-256 hash (hex) to avoid leaking the raw token if DB is exposed.
ALTER TABLE "Channel"
  ADD COLUMN IF NOT EXISTS "submissionsControlTokenHash" TEXT;

-- Unique lookup by token hash (fast auth for public control endpoint).
CREATE UNIQUE INDEX IF NOT EXISTS "Channel_submissionsControlTokenHash_key"
  ON "Channel" ("submissionsControlTokenHash");


