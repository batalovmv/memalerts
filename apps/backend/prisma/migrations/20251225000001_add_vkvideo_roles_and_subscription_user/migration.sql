-- Add VKVideo subscription owner userId (optional, back-compat)
ALTER TABLE "VkVideoChatBotSubscription"
ADD COLUMN IF NOT EXISTS "userId" TEXT;

CREATE INDEX IF NOT EXISTS "VkVideoChatBotSubscription_userId_idx"
ON "VkVideoChatBotSubscription" ("userId");

-- Postgres does NOT support `ADD CONSTRAINT IF NOT EXISTS`, so we guard via pg_constraint.
-- This keeps the migration idempotent across staged deployments / re-runs.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'VkVideoChatBotSubscription_userId_fkey'
  ) THEN
    ALTER TABLE "VkVideoChatBotSubscription"
    ADD CONSTRAINT "VkVideoChatBotSubscription_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
EXCEPTION
  WHEN duplicate_object THEN
    -- ignore race / already exists
    NULL;
END $$;

-- Add VKVideo roles allowlist to ChatBotCommand (stored as jsonb array of role ids)
ALTER TABLE "ChatBotCommand"
ADD COLUMN IF NOT EXISTS "vkvideoAllowedRoleIds" JSONB NOT NULL DEFAULT '[]'::jsonb;


