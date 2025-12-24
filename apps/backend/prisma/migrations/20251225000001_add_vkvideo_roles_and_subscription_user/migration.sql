-- Add VKVideo subscription owner userId (optional, back-compat)
ALTER TABLE "VkVideoChatBotSubscription"
ADD COLUMN IF NOT EXISTS "userId" TEXT;

CREATE INDEX IF NOT EXISTS "VkVideoChatBotSubscription_userId_idx"
ON "VkVideoChatBotSubscription" ("userId");

ALTER TABLE "VkVideoChatBotSubscription"
ADD CONSTRAINT IF NOT EXISTS "VkVideoChatBotSubscription_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Add VKVideo roles allowlist to ChatBotCommand (stored as jsonb array of role ids)
ALTER TABLE "ChatBotCommand"
ADD COLUMN IF NOT EXISTS "vkvideoAllowedRoleIds" JSONB NOT NULL DEFAULT '[]'::jsonb;


