import type { ChannelEconomy, MemeDetail } from '@memalerts/api-contracts';

export type ChannelInfo = {
  id: string;
  slug: string;
  name: string;
  memeCatalogMode?: 'channel' | 'pool_all';
  coinPerPointRatio: number;
  coinIconUrl?: string | null;
  rewardTitle?: string | null;
  primaryColor?: string | null;
  secondaryColor?: string | null;
  accentColor?: string | null;
  submissionsEnabled?: boolean;
  submissionsOnlyWhenLive?: boolean;
  wheelEnabled?: boolean;
  wheelPaidSpinCostCoins?: number | null;
  wheelPrizeMultiplier?: number;
  createdAt: string;
  memes: MemeDetail[];
  owner?: {
    id: string;
    displayName: string;
    profileImageUrl?: string | null;
  } | null;
  stats: {
    memesCount: number;
    usersCount: number;
  };
  economy?: ChannelEconomy;
};


