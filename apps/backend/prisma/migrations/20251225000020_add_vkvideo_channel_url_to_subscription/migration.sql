-- Add vkvideoChannelUrl to VkVideoChatBotSubscription (expand-only, safe for shared DB).

ALTER TABLE "VkVideoChatBotSubscription"
  ADD COLUMN IF NOT EXISTS "vkvideoChannelUrl" TEXT;

CREATE INDEX IF NOT EXISTS "VkVideoChatBotSubscription_vkvideoChannelUrl_idx"
  ON "VkVideoChatBotSubscription"("vkvideoChannelUrl");


