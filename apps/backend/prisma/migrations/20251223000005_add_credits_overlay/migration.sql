-- Add OBS "Credits" (titres) overlay settings + token rotation
ALTER TABLE "Channel"
  ADD COLUMN IF NOT EXISTS "creditsStyleJson" TEXT,
  ADD COLUMN IF NOT EXISTS "creditsTokenVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "creditsReconnectWindowMinutes" INTEGER NOT NULL DEFAULT 60;


