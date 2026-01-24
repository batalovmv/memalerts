import type { BaseAutoRewardsConfig } from './base';

export type TrovoAutoRewardsV1 = BaseAutoRewardsConfig & {
  follow?: { enabled?: boolean; coins?: number; onceEver?: boolean; onlyWhenLive?: boolean };
  subscribe?: { enabled?: boolean; tierCoins?: Record<string, number>; onlyWhenLive?: boolean };
  raid?: { enabled?: boolean; baseCoins?: number; coinsPerViewer?: number; minViewers?: number };
};
