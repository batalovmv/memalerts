-- Add database-level constraints for data validation and security
-- These constraints ensure data integrity even if application-level validation is bypassed
-- Created: 2025-01-17
-- Purpose: Add CHECK constraints to enforce business rules and prevent invalid data at the database level

-- Wallet constraints: balance cannot be negative
ALTER TABLE "Wallet" 
ADD CONSTRAINT "wallet_balance_non_negative" 
CHECK ("balance" >= 0);

-- Promotion constraints: discount must be between 0 and 100
ALTER TABLE "Promotion" 
ADD CONSTRAINT "promotion_discount_range" 
CHECK ("discountPercent" >= 0 AND "discountPercent" <= 100);

-- Promotion constraints: end date must be after start date
ALTER TABLE "Promotion" 
ADD CONSTRAINT "promotion_date_range" 
CHECK ("endDate" > "startDate");

-- Channel constraints: coin per point ratio must be positive
ALTER TABLE "Channel" 
ADD CONSTRAINT "channel_coin_per_point_positive" 
CHECK ("coinPerPointRatio" > 0);

-- Meme constraints: price and duration must be non-negative
ALTER TABLE "Meme" 
ADD CONSTRAINT "meme_price_non_negative" 
CHECK ("priceCoins" >= 0);

ALTER TABLE "Meme" 
ADD CONSTRAINT "meme_duration_positive" 
CHECK ("durationMs" > 0);

-- Meme constraints: status must be one of allowed values
ALTER TABLE "Meme" 
ADD CONSTRAINT "meme_status_valid" 
CHECK ("status" IN ('pending', 'approved', 'rejected'));

-- Meme constraints: type must be one of allowed values
ALTER TABLE "Meme" 
ADD CONSTRAINT "meme_type_valid" 
CHECK ("type" IN ('image', 'gif', 'video', 'audio'));

-- MemeSubmission constraints: status must be one of allowed values
ALTER TABLE "MemeSubmission" 
ADD CONSTRAINT "meme_submission_status_valid" 
CHECK ("status" IN ('pending', 'approved', 'rejected'));

-- MemeSubmission constraints: type must be one of allowed values
ALTER TABLE "MemeSubmission" 
ADD CONSTRAINT "meme_submission_type_valid" 
CHECK ("type" IN ('image', 'gif', 'video', 'audio'));

-- Redemption constraints: points and coins must be non-negative
ALTER TABLE "Redemption" 
ADD CONSTRAINT "redemption_points_positive" 
CHECK ("pointsSpent" > 0);

ALTER TABLE "Redemption" 
ADD CONSTRAINT "redemption_coins_non_negative" 
CHECK ("coinsGranted" >= 0);

-- Redemption constraints: status must be one of allowed values
ALTER TABLE "Redemption" 
ADD CONSTRAINT "redemption_status_valid" 
CHECK ("status" IN ('pending', 'completed', 'failed'));

-- MemeActivation constraints: coins spent must be non-negative
ALTER TABLE "MemeActivation" 
ADD CONSTRAINT "meme_activation_coins_non_negative" 
CHECK ("coinsSpent" >= 0);

-- MemeActivation constraints: status must be one of allowed values
ALTER TABLE "MemeActivation" 
ADD CONSTRAINT "meme_activation_status_valid" 
CHECK ("status" IN ('queued', 'playing', 'done', 'failed'));

-- User constraints: role must be one of allowed values
ALTER TABLE "User" 
ADD CONSTRAINT "user_role_valid" 
CHECK ("role" IN ('viewer', 'streamer', 'admin'));

-- BetaAccess constraints: status must be one of allowed values
ALTER TABLE "BetaAccess" 
ADD CONSTRAINT "beta_access_status_valid" 
CHECK ("status" IN ('pending', 'approved', 'rejected'));

-- Channel constraints: reward cost and coins must be non-negative if set
ALTER TABLE "Channel" 
ADD CONSTRAINT "channel_reward_cost_non_negative" 
CHECK ("rewardCost" IS NULL OR "rewardCost" > 0);

ALTER TABLE "Channel" 
ADD CONSTRAINT "channel_reward_coins_non_negative" 
CHECK ("rewardCoins" IS NULL OR "rewardCoins" >= 0);

-- Channel constraints: hex color format validation (if provided)
-- Hex colors must be 7 characters starting with # followed by 6 hex digits
ALTER TABLE "Channel" 
ADD CONSTRAINT "channel_primary_color_format" 
CHECK ("primaryColor" IS NULL OR ("primaryColor" ~ '^#[0-9A-Fa-f]{6}$'));

ALTER TABLE "Channel" 
ADD CONSTRAINT "channel_secondary_color_format" 
CHECK ("secondaryColor" IS NULL OR ("secondaryColor" ~ '^#[0-9A-Fa-f]{6}$'));

ALTER TABLE "Channel" 
ADD CONSTRAINT "channel_accent_color_format" 
CHECK ("accentColor" IS NULL OR ("accentColor" ~ '^#[0-9A-Fa-f]{6}$'));

-- FileHash constraints: reference count must be positive
ALTER TABLE "FileHash" 
ADD CONSTRAINT "file_hash_reference_count_positive" 
CHECK ("referenceCount" > 0);

-- FileHash constraints: file size must be non-negative
ALTER TABLE "FileHash" 
ADD CONSTRAINT "file_hash_size_non_negative" 
CHECK ("fileSize" >= 0);

