import { useState } from 'react';

import type { RewardSettingsState } from '@/features/settings/tabs/rewards/types';

const DEFAULT_REWARD_SETTINGS: RewardSettingsState = {
  rewardIdForCoins: '',
  rewardEnabled: false,
  rewardTitle: '',
  rewardCost: '',
  rewardCoins: '',
  rewardOnlyWhenLive: false,
  vkvideoRewardEnabled: false,
  vkvideoRewardIdForCoins: '',
  vkvideoCoinPerPointRatio: '1',
  vkvideoRewardCoins: '',
  vkvideoRewardOnlyWhenLive: false,
  submissionRewardCoinsUpload: '0',
  submissionRewardCoinsPool: '0',
  submissionRewardOnlyWhenLive: false,
  economyMemesPerHour: '2',
  economyAvgMemePriceCoins: '100',
  economyRewardMultiplier: '1',
  wheelEnabled: true,
  wheelPaidSpinCostCoins: '',
  wheelPrizeMultiplier: '1',
};

export function useRewardsSettingsState() {
  const [rewardSettings, setRewardSettings] = useState<RewardSettingsState>(DEFAULT_REWARD_SETTINGS);

  return { rewardSettings, setRewardSettings };
}
