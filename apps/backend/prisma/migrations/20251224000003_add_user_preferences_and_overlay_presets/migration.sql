-- Add per-user preferences (cross-device) and per-channel overlay presets.
-- Safe additive migration for shared DB (beta/prod).

-- 1) Channel overlay presets (stored as JSON string, validated by API).
ALTER TABLE "Channel"
ADD COLUMN IF NOT EXISTS "overlayPresetsJson" TEXT;

-- 2) User preferences table (one row per user).
CREATE TABLE IF NOT EXISTS "UserPreference" (
  -- Keep IDs as TEXT to match existing schema where User.id is TEXT (not UUID).
  "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
  "userId" TEXT NOT NULL,
  "theme" TEXT NOT NULL DEFAULT 'light',
  "autoplayMemesEnabled" BOOLEAN NOT NULL DEFAULT TRUE,
  "memeModalMuted" BOOLEAN NOT NULL DEFAULT FALSE,
  "coinsInfoSeen" BOOLEAN NOT NULL DEFAULT FALSE,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "UserPreference_pkey" PRIMARY KEY ("id")
);

-- Unique 1:1 with user.
CREATE UNIQUE INDEX IF NOT EXISTS "UserPreference_userId_key" ON "UserPreference" ("userId");

-- FK + cascade delete.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'UserPreference_userId_fkey'
  ) THEN
    ALTER TABLE "UserPreference"
    ADD CONSTRAINT "UserPreference_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "UserPreference_userId_idx" ON "UserPreference" ("userId");


