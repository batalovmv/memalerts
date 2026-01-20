-- Add live-only flag for per-channel chat bot commands.
-- Additive migration (safe for shared DB / expand step).

ALTER TABLE "ChatBotCommand"
  ADD COLUMN IF NOT EXISTS "onlyWhenLive" BOOLEAN NOT NULL DEFAULT false;


