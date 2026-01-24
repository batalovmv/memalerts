import type { BaseAutoRewardsConfig } from './base';

export type KickAutoRewardsV1 = BaseAutoRewardsConfig & {
  follow?: { enabled?: boolean; coins?: number; onceEver?: boolean; onlyWhenLive?: boolean };
  subscribe?: { enabled?: boolean; tierCoins?: Record<string, number>; onlyWhenLive?: boolean };
  giftSub?: { enabled?: boolean; giverCoins?: number; recipientCoins?: number; onlyWhenLive?: boolean };
};
