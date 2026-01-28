-- Backfill database constraints (idempotent)

DO $$
BEGIN
  IF to_regclass('"Wallet"') IS NOT NULL
      AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Wallet' AND column_name = 'balance')
      AND NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'wallet_balance_non_negative'
      ) THEN
    ALTER TABLE "Wallet"
      ADD CONSTRAINT "wallet_balance_non_negative"
      CHECK ("balance" >= 0);
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('"Promotion"') IS NOT NULL
      AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Promotion' AND column_name = 'discountPercent')
      AND NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'promotion_discount_range'
      ) THEN
    ALTER TABLE "Promotion"
      ADD CONSTRAINT "promotion_discount_range"
      CHECK ("discountPercent" >= 0 AND "discountPercent" <= 100);
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('"Promotion"') IS NOT NULL
      AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Promotion' AND column_name = 'startDate') AND
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Promotion' AND column_name = 'endDate')
      AND NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'promotion_date_range'
      ) THEN
    ALTER TABLE "Promotion"
      ADD CONSTRAINT "promotion_date_range"
      CHECK ("endDate" > "startDate");
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('"Channel"') IS NOT NULL
      AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Channel' AND column_name = 'coinPerPointRatio')
      AND NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'channel_coin_per_point_positive'
      ) THEN
    ALTER TABLE "Channel"
      ADD CONSTRAINT "channel_coin_per_point_positive"
      CHECK ("coinPerPointRatio" > 0);
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('"Meme"') IS NOT NULL
      AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Meme' AND column_name = 'priceCoins')
      AND NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'meme_price_non_negative'
      ) THEN
    ALTER TABLE "Meme"
      ADD CONSTRAINT "meme_price_non_negative"
      CHECK ("priceCoins" >= 0);
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('"Meme"') IS NOT NULL
      AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Meme' AND column_name = 'durationMs')
      AND NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'meme_duration_positive'
      ) THEN
    ALTER TABLE "Meme"
      ADD CONSTRAINT "meme_duration_positive"
      CHECK ("durationMs" > 0);
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('"Meme"') IS NOT NULL
      AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Meme' AND column_name = 'status')
      AND NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'meme_status_valid'
      ) THEN
    ALTER TABLE "Meme"
      ADD CONSTRAINT "meme_status_valid"
      CHECK ("status" IN ('pending', 'approved', 'rejected'));
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('"Meme"') IS NOT NULL
      AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Meme' AND column_name = 'type')
      AND NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'meme_type_valid'
      ) THEN
    ALTER TABLE "Meme"
      ADD CONSTRAINT "meme_type_valid"
      CHECK ("type" IN ('image', 'gif', 'video', 'audio'));
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('"MemeSubmission"') IS NOT NULL
      AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'MemeSubmission' AND column_name = 'status')
      AND NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'meme_submission_status_valid'
      ) THEN
    ALTER TABLE "MemeSubmission"
      ADD CONSTRAINT "meme_submission_status_valid"
      CHECK ("status" IN ('pending', 'approved', 'rejected'));
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('"MemeSubmission"') IS NOT NULL
      AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'MemeSubmission' AND column_name = 'type')
      AND NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'meme_submission_type_valid'
      ) THEN
    ALTER TABLE "MemeSubmission"
      ADD CONSTRAINT "meme_submission_type_valid"
      CHECK ("type" IN ('image', 'gif', 'video', 'audio'));
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('"Redemption"') IS NOT NULL
      AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Redemption' AND column_name = 'pointsSpent')
      AND NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'redemption_points_positive'
      ) THEN
    ALTER TABLE "Redemption"
      ADD CONSTRAINT "redemption_points_positive"
      CHECK ("pointsSpent" > 0);
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('"Redemption"') IS NOT NULL
      AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Redemption' AND column_name = 'coinsGranted')
      AND NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'redemption_coins_non_negative'
      ) THEN
    ALTER TABLE "Redemption"
      ADD CONSTRAINT "redemption_coins_non_negative"
      CHECK ("coinsGranted" >= 0);
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('"Redemption"') IS NOT NULL
      AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Redemption' AND column_name = 'status')
      AND NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'redemption_status_valid'
      ) THEN
    ALTER TABLE "Redemption"
      ADD CONSTRAINT "redemption_status_valid"
      CHECK ("status" IN ('pending', 'completed', 'failed'));
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('"MemeActivation"') IS NOT NULL
      AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'MemeActivation' AND column_name = 'coinsSpent')
      AND NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'meme_activation_coins_non_negative'
      ) THEN
    ALTER TABLE "MemeActivation"
      ADD CONSTRAINT "meme_activation_coins_non_negative"
      CHECK ("coinsSpent" >= 0);
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('"MemeActivation"') IS NOT NULL
      AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'MemeActivation' AND column_name = 'status')
      AND NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'meme_activation_status_valid'
      ) THEN
    ALTER TABLE "MemeActivation"
      ADD CONSTRAINT "meme_activation_status_valid"
      CHECK ("status" IN ('queued', 'playing', 'done', 'failed'));
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('"User"') IS NOT NULL
      AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'User' AND column_name = 'role')
      AND NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'user_role_valid'
      ) THEN
    ALTER TABLE "User"
      ADD CONSTRAINT "user_role_valid"
      CHECK ("role" IN ('viewer', 'streamer', 'admin'));
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('"BetaAccess"') IS NOT NULL
      AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'BetaAccess' AND column_name = 'status')
      AND NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'beta_access_status_valid'
      ) THEN
    ALTER TABLE "BetaAccess"
      ADD CONSTRAINT "beta_access_status_valid"
      CHECK ("status" IN ('pending', 'approved', 'rejected'));
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('"Channel"') IS NOT NULL
      AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Channel' AND column_name = 'rewardCost')
      AND NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'channel_reward_cost_non_negative'
      ) THEN
    ALTER TABLE "Channel"
      ADD CONSTRAINT "channel_reward_cost_non_negative"
      CHECK ("rewardCost" IS NULL OR "rewardCost" > 0);
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('"Channel"') IS NOT NULL
      AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Channel' AND column_name = 'rewardCoins')
      AND NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'channel_reward_coins_non_negative'
      ) THEN
    ALTER TABLE "Channel"
      ADD CONSTRAINT "channel_reward_coins_non_negative"
      CHECK ("rewardCoins" IS NULL OR "rewardCoins" >= 0);
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('"Channel"') IS NOT NULL
      AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Channel' AND column_name = 'primaryColor')
      AND NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'channel_primary_color_format'
      ) THEN
    ALTER TABLE "Channel"
      ADD CONSTRAINT "channel_primary_color_format"
      CHECK ("primaryColor" IS NULL OR ("primaryColor" ~ '^#[0-9A-Fa-f]{6}$'));
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('"Channel"') IS NOT NULL
      AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Channel' AND column_name = 'secondaryColor')
      AND NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'channel_secondary_color_format'
      ) THEN
    ALTER TABLE "Channel"
      ADD CONSTRAINT "channel_secondary_color_format"
      CHECK ("secondaryColor" IS NULL OR ("secondaryColor" ~ '^#[0-9A-Fa-f]{6}$'));
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('"Channel"') IS NOT NULL
      AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Channel' AND column_name = 'accentColor')
      AND NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'channel_accent_color_format'
      ) THEN
    ALTER TABLE "Channel"
      ADD CONSTRAINT "channel_accent_color_format"
      CHECK ("accentColor" IS NULL OR ("accentColor" ~ '^#[0-9A-Fa-f]{6}$'));
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('"FileHash"') IS NOT NULL
      AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'FileHash' AND column_name = 'referenceCount')
      AND NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'file_hash_reference_count_positive'
      ) THEN
    ALTER TABLE "FileHash"
      ADD CONSTRAINT "file_hash_reference_count_positive"
      CHECK ("referenceCount" > 0);
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('"FileHash"') IS NOT NULL
      AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'FileHash' AND column_name = 'fileSize')
      AND NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'file_hash_size_non_negative'
      ) THEN
    ALTER TABLE "FileHash"
      ADD CONSTRAINT "file_hash_size_non_negative"
      CHECK ("fileSize" >= 0);
  END IF;
END $$;
