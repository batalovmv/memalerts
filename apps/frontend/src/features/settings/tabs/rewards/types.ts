export type RewardsPlatformId = 'twitch' | 'vkvideo' | 'submissions' | 'economy' | 'wheel';

export type RewardSettingsState = {
  rewardIdForCoins: string;
  rewardEnabled: boolean;
  rewardTitle: string;
  rewardCost: string;
  rewardCoins: string;
  rewardOnlyWhenLive: boolean;
  vkvideoRewardEnabled: boolean;
  vkvideoRewardIdForCoins: string;
  vkvideoCoinPerPointRatio: string;
  vkvideoRewardCoins: string;
  vkvideoRewardOnlyWhenLive: boolean;
  submissionRewardCoinsUpload: string;
  submissionRewardCoinsPool: string;
  submissionRewardOnlyWhenLive: boolean;
  economyMemesPerHour: string;
  economyAvgMemePriceCoins: string;
  economyRewardMultiplier: string;
  wheelEnabled: boolean;
  wheelPaidSpinCostCoins: string;
  wheelPrizeMultiplier: string;
};

