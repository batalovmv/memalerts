-- Add per-channel ignore list for credits "chatters" (viewer list).
-- Stored as JSONB array of strings; compared case-insensitively in application code.

ALTER TABLE "Channel"
ADD COLUMN IF NOT EXISTS "creditsIgnoredChattersJson" JSONB NOT NULL DEFAULT '[]'::jsonb;


