import type { BaseAutoRewardsConfig } from './base';

export type YouTubeAutoRewardsV1 = BaseAutoRewardsConfig & {
  subscribe?: { enabled?: boolean; coins?: number; onceEver?: boolean };
  superchat?: { enabled?: boolean; coinsPerCurrency?: Record<string, number>; minAmount?: number };
  membership?: { enabled?: boolean; tierCoins?: Record<string, number> };
  like?: { enabled?: boolean; coins?: number; maxPerStream?: number };
};
