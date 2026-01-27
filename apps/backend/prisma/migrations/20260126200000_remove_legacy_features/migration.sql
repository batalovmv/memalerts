-- Cleanup removed integrations/features: drop columns, tables, and shrink enums.

-- Remove rows that would block enum narrowing.
DELETE FROM "ExternalRewardEvent"
WHERE "provider" IN ('kick', 'trovo')
   OR "eventType" IN (
     'kick_reward_redemption',
     'trovo_spell',
     'twitch_follow',
     'twitch_subscribe',
     'twitch_resub_message',
     'twitch_gift_sub',
     'twitch_cheer',
     'twitch_raid',
     'twitch_chat_first_message',
     'twitch_chat_messages_threshold',
     'twitch_chat_daily_streak'
   )
   OR "currency" IN (
     'kick_channel_points',
     'trovo_mana',
     'trovo_elixir',
     'twitch_bits',
     'twitch_units'
   );

DELETE FROM "ExternalWebhookDeliveryDedup" WHERE "provider" IN ('kick', 'trovo');
DELETE FROM "PendingCoinGrant" WHERE "provider" IN ('kick', 'trovo');
DELETE FROM "BotIntegrationSettings" WHERE "provider" IN ('kick', 'trovo');
DELETE FROM "ExternalAccount" WHERE "provider" IN ('kick', 'trovo', 'boosty', 'discord');
DELETE FROM "OAuthState" WHERE "provider" IN ('kick', 'trovo', 'boosty', 'discord');

-- Drop legacy columns from Channel.
ALTER TABLE "Channel"
  DROP COLUMN IF EXISTS "kickRewardEnabled",
  DROP COLUMN IF EXISTS "kickRewardIdForCoins",
  DROP COLUMN IF EXISTS "kickCoinPerPointRatio",
  DROP COLUMN IF EXISTS "kickRewardCoins",
  DROP COLUMN IF EXISTS "kickRewardOnlyWhenLive",
  DROP COLUMN IF EXISTS "kickRewardsSubscriptionId",
  DROP COLUMN IF EXISTS "trovoManaCoinsPerUnit",
  DROP COLUMN IF EXISTS "trovoElixirCoinsPerUnit",
  DROP COLUMN IF EXISTS "youtubeLikeRewardEnabled",
  DROP COLUMN IF EXISTS "youtubeLikeRewardCoins",
  DROP COLUMN IF EXISTS "youtubeLikeRewardOnlyWhenLive",
  DROP COLUMN IF EXISTS "twitchAutoRewardsJson",
  DROP COLUMN IF EXISTS "dynamicPricingEnabled",
  DROP COLUMN IF EXISTS "dynamicPricingMinMult",
  DROP COLUMN IF EXISTS "dynamicPricingMaxMult",
  DROP COLUMN IF EXISTS "creditsStyleJson",
  DROP COLUMN IF EXISTS "creditsIgnoredChattersJson",
  DROP COLUMN IF EXISTS "creditsTokenVersion",
  DROP COLUMN IF EXISTS "creditsReconnectWindowMinutes",
  DROP COLUMN IF EXISTS "chatRewardsJson",
  DROP COLUMN IF EXISTS "streamDurationCommandJson",
  DROP COLUMN IF EXISTS "followGreetingsEnabled",
  DROP COLUMN IF EXISTS "followGreetingTemplate",
  DROP COLUMN IF EXISTS "boostyBlogName",
  DROP COLUMN IF EXISTS "boostyCoinsPerSub",
  DROP COLUMN IF EXISTS "boostyTierCoinsJson",
  DROP COLUMN IF EXISTS "boostyDiscordRoleId",
  DROP COLUMN IF EXISTS "boostyDiscordTierRolesJson",
  DROP COLUMN IF EXISTS "discordSubscriptionsGuildId";

-- Drop legacy tables.
DROP TABLE IF EXISTS "YouTubeLikeRewardClaim";
DROP TABLE IF EXISTS "ChatBotCommand";
DROP TABLE IF EXISTS "TrovoChatBotSubscription";
DROP TABLE IF EXISTS "TrovoChatBotOutboxMessage";
DROP TABLE IF EXISTS "KickChatBotSubscription";
DROP TABLE IF EXISTS "KickChatBotOutboxMessage";
DROP TABLE IF EXISTS "TrovoBotIntegration";
DROP TABLE IF EXISTS "GlobalTrovoBotCredential";
DROP TABLE IF EXISTS "KickBotIntegration";
DROP TABLE IF EXISTS "GlobalKickBotCredential";
DROP TABLE IF EXISTS "BoostySubscriptionReward";
DROP TABLE IF EXISTS "BoostyDiscordSubscriptionReward";
DROP TABLE IF EXISTS "BoostyDiscordSubscriptionRewardV2";

-- Shrink enums.
CREATE TYPE "ExternalRewardProvider_new" AS ENUM ('vkvideo', 'twitch');
ALTER TABLE "ExternalRewardEvent"
  ALTER COLUMN "provider" TYPE "ExternalRewardProvider_new" USING ("provider"::text::"ExternalRewardProvider_new");
ALTER TABLE "ExternalWebhookDeliveryDedup"
  ALTER COLUMN "provider" TYPE "ExternalRewardProvider_new" USING ("provider"::text::"ExternalRewardProvider_new");
ALTER TABLE "PendingCoinGrant"
  ALTER COLUMN "provider" TYPE "ExternalRewardProvider_new" USING ("provider"::text::"ExternalRewardProvider_new");
DROP TYPE "ExternalRewardProvider";
ALTER TYPE "ExternalRewardProvider_new" RENAME TO "ExternalRewardProvider";

CREATE TYPE "ExternalRewardEventType_new" AS ENUM ('vkvideo_channel_points_redemption', 'twitch_channel_points_redemption');
ALTER TABLE "ExternalRewardEvent"
  ALTER COLUMN "eventType" TYPE "ExternalRewardEventType_new" USING ("eventType"::text::"ExternalRewardEventType_new");
DROP TYPE "ExternalRewardEventType";
ALTER TYPE "ExternalRewardEventType_new" RENAME TO "ExternalRewardEventType";

CREATE TYPE "ExternalRewardCurrency_new" AS ENUM ('vkvideo_channel_points', 'twitch_channel_points');
ALTER TABLE "ExternalRewardEvent"
  ALTER COLUMN "currency" TYPE "ExternalRewardCurrency_new" USING ("currency"::text::"ExternalRewardCurrency_new");
DROP TYPE "ExternalRewardCurrency";
ALTER TYPE "ExternalRewardCurrency_new" RENAME TO "ExternalRewardCurrency";

CREATE TYPE "BotIntegrationProvider_new" AS ENUM ('twitch', 'vkplaylive', 'vkvideo', 'youtube');
ALTER TABLE "BotIntegrationSettings"
  ALTER COLUMN "provider" TYPE "BotIntegrationProvider_new" USING ("provider"::text::"BotIntegrationProvider_new");
DROP TYPE "BotIntegrationProvider";
ALTER TYPE "BotIntegrationProvider_new" RENAME TO "BotIntegrationProvider";

CREATE TYPE "ExternalAccountProvider_new" AS ENUM ('twitch', 'youtube', 'vk', 'vkvideo', 'vkplay');
ALTER TABLE "ExternalAccount"
  ALTER COLUMN "provider" TYPE "ExternalAccountProvider_new" USING ("provider"::text::"ExternalAccountProvider_new");
ALTER TABLE "OAuthState"
  ALTER COLUMN "provider" TYPE "ExternalAccountProvider_new" USING ("provider"::text::"ExternalAccountProvider_new");
DROP TYPE "ExternalAccountProvider";
ALTER TYPE "ExternalAccountProvider_new" RENAME TO "ExternalAccountProvider";
