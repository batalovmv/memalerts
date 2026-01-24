export type RewardsPlatformId = 'common' | 'twitch' | 'youtube' | 'kick' | 'vkvideo' | 'trovo' | 'submissions' | 'boosty';

export type RewardSettingsState = {
  youtubeLikeRewardEnabled: boolean;
  youtubeLikeRewardCoins: string;
  youtubeLikeRewardOnlyWhenLive: boolean;
  rewardIdForCoins: string;
  rewardEnabled: boolean;
  rewardTitle: string;
  rewardCost: string;
  rewardCoins: string;
  rewardOnlyWhenLive: boolean;
  kickRewardEnabled: boolean;
  kickRewardIdForCoins: string;
  kickCoinPerPointRatio: string;
  kickRewardCoins: string;
  kickRewardOnlyWhenLive: boolean;
  trovoManaCoinsPerUnit: string;
  trovoElixirCoinsPerUnit: string;
  vkvideoRewardEnabled: boolean;
  vkvideoRewardIdForCoins: string;
  vkvideoCoinPerPointRatio: string;
  vkvideoRewardCoins: string;
  vkvideoRewardOnlyWhenLive: boolean;
  submissionRewardCoinsUpload: string;
  submissionRewardCoinsPool: string;
  submissionRewardOnlyWhenLive: boolean;
};

export type BoostyTierCoinsRow = { tierKey: string; coins: string };

export type BoostyTierCoinsRowErrors = Record<number, { tierKey?: string; coins?: string }>;

export type BoostyTierCoinsErrorState = { table?: string | null; rows: BoostyTierCoinsRowErrors };

export type BoostySettingsState = {
  boostyBlogName: string;
  boostyCoinsPerSub: string;
  boostyTierCoins: BoostyTierCoinsRow[];
};
