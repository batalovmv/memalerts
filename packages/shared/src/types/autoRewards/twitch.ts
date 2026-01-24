import type { BaseAutoRewardsConfig } from './base';

/**
 * Auto rewards config shared across Twitch/Kick/Trovo/VKVideo.
 * Stored in DB as Channel.twitchAutoRewardsJson; updated via PATCH /streamer/channel/settings { twitchAutoRewards }.
 */
export type TwitchAutoRewardsV1 = BaseAutoRewardsConfig & {
  follow?: { enabled?: boolean; coins?: number; onceEver?: boolean; onlyWhenLive?: boolean };
  subscribe?: { enabled?: boolean; tierCoins?: Record<string, number>; primeCoins?: number; onlyWhenLive?: boolean };
  resubMessage?: {
    enabled?: boolean;
    tierCoins?: Record<string, number>;
    primeCoins?: number;
    bonusCoins?: number;
    onlyWhenLive?: boolean;
  };
  giftSub?: {
    enabled?: boolean;
    giverTierCoins?: Record<string, number>;
    recipientCoins?: number;
    onlyWhenLive?: boolean;
  };
  cheer?: { enabled?: boolean; bitsPerCoin?: number; minBits?: number; onlyWhenLive?: boolean };
  raid?: { enabled?: boolean; baseCoins?: number; coinsPerViewer?: number; minViewers?: number; onlyWhenLive?: boolean };
  channelPoints?: { enabled?: boolean; byRewardId?: Record<string, number>; onlyWhenLive?: boolean };
  chat?: {
    firstMessage?: { enabled?: boolean; coins?: number; onlyWhenLive?: boolean };
    messageThresholds?: {
      enabled?: boolean;
      thresholds?: number[];
      coinsByThreshold?: Record<string, number>;
      onlyWhenLive?: boolean;
    };
    dailyStreak?: { enabled?: boolean; coinsPerDay?: number; coinsByStreak?: Record<string, number> };
  };
};
