-- Add audience settings for chat bot commands:
-- - allowed_roles: JSONB array of roles (vip/moderator/subscriber/follower)
-- - allowed_users: JSONB array of twitch logins (lowercase, without '@')

ALTER TABLE "ChatBotCommand"
  ADD COLUMN IF NOT EXISTS "allowedRoles" JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS "allowedUsers" JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS "ChatBotCommand_allowedRoles_idx" ON "ChatBotCommand" USING GIN ("allowedRoles");
CREATE INDEX IF NOT EXISTS "ChatBotCommand_allowedUsers_idx" ON "ChatBotCommand" USING GIN ("allowedUsers");


