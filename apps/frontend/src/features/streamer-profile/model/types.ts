import type { Meme } from '@/types';

export type ChannelInfo = {
  id: string;
  slug: string;
  name: string;
  memeCatalogMode?: 'channel' | 'pool_all';
  coinPerPointRatio: number;
  youtubeLikeRewardEnabled?: boolean;
  youtubeLikeRewardCoins?: number;
  youtubeLikeRewardOnlyWhenLive?: boolean;
  coinIconUrl?: string | null;
  rewardTitle?: string | null;
  primaryColor?: string | null;
  secondaryColor?: string | null;
  accentColor?: string | null;
  dynamicPricingEnabled?: boolean;
  dynamicPricingMinMult?: number;
  dynamicPricingMaxMult?: number;
  submissionsEnabled?: boolean;
  submissionsOnlyWhenLive?: boolean;
  createdAt: string;
  memes: Meme[];
  owner?: {
    id: string;
    displayName: string;
    profileImageUrl?: string | null;
  } | null;
  stats: {
    memesCount: number;
    usersCount: number;
  };
};
