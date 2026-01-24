import type { BaseAutoRewardsConfig } from './base';

export type VkVideoAutoRewardsV1 = BaseAutoRewardsConfig & {
  follow?: { enabled?: boolean; coins?: number; onceEver?: boolean; onlyWhenLive?: boolean };
  donation?: { enabled?: boolean; coinsPerRuble?: number; minAmount?: number };
};
