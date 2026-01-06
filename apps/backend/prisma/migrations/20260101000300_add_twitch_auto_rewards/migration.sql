-- Twitch auto rewards: extend external rewards ledger enums + add per-channel settings JSONB.
-- Safe for environments where schema might already be partially applied (prod/beta shared DB / db push).

DO $$
BEGIN
  -- External rewards enums: add Twitch provider + event types + currencies.
  BEGIN
    ALTER TYPE "ExternalRewardProvider" ADD VALUE IF NOT EXISTS 'twitch';
  EXCEPTION
    WHEN duplicate_object THEN NULL;
  END;

  BEGIN
    ALTER TYPE "ExternalRewardEventType" ADD VALUE IF NOT EXISTS 'twitch_follow';
  EXCEPTION
    WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER TYPE "ExternalRewardEventType" ADD VALUE IF NOT EXISTS 'twitch_subscribe';
  EXCEPTION
    WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER TYPE "ExternalRewardEventType" ADD VALUE IF NOT EXISTS 'twitch_resub_message';
  EXCEPTION
    WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER TYPE "ExternalRewardEventType" ADD VALUE IF NOT EXISTS 'twitch_gift_sub';
  EXCEPTION
    WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER TYPE "ExternalRewardEventType" ADD VALUE IF NOT EXISTS 'twitch_cheer';
  EXCEPTION
    WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER TYPE "ExternalRewardEventType" ADD VALUE IF NOT EXISTS 'twitch_raid';
  EXCEPTION
    WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER TYPE "ExternalRewardEventType" ADD VALUE IF NOT EXISTS 'twitch_channel_points_redemption';
  EXCEPTION
    WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER TYPE "ExternalRewardEventType" ADD VALUE IF NOT EXISTS 'twitch_chat_first_message';
  EXCEPTION
    WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER TYPE "ExternalRewardEventType" ADD VALUE IF NOT EXISTS 'twitch_chat_messages_threshold';
  EXCEPTION
    WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER TYPE "ExternalRewardEventType" ADD VALUE IF NOT EXISTS 'twitch_chat_daily_streak';
  EXCEPTION
    WHEN duplicate_object THEN NULL;
  END;

  BEGIN
    ALTER TYPE "ExternalRewardCurrency" ADD VALUE IF NOT EXISTS 'twitch_channel_points';
  EXCEPTION
    WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER TYPE "ExternalRewardCurrency" ADD VALUE IF NOT EXISTS 'twitch_bits';
  EXCEPTION
    WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER TYPE "ExternalRewardCurrency" ADD VALUE IF NOT EXISTS 'twitch_units';
  EXCEPTION
    WHEN duplicate_object THEN NULL;
  END;
END $$;

ALTER TABLE "Channel"
  ADD COLUMN IF NOT EXISTS "twitchAutoRewardsJson" JSONB;







