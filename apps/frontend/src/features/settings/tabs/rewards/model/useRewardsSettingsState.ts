import { useState } from 'react';

import type { RewardSettingsState } from '@/features/settings/tabs/rewards/types';

const DEFAULT_REWARD_SETTINGS: RewardSettingsState = {
  youtubeLikeRewardEnabled: false,
  youtubeLikeRewardCoins: '10',
  youtubeLikeRewardOnlyWhenLive: true,
  rewardIdForCoins: '',
  rewardEnabled: false,
  rewardTitle: '',
  rewardCost: '',
  rewardCoins: '',
  rewardOnlyWhenLive: false,
  kickRewardEnabled: false,
  kickRewardIdForCoins: '',
  kickCoinPerPointRatio: '1',
  kickRewardCoins: '',
  kickRewardOnlyWhenLive: false,
  trovoManaCoinsPerUnit: '0',
  trovoElixirCoinsPerUnit: '0',
  vkvideoRewardEnabled: false,
  vkvideoRewardIdForCoins: '',
  vkvideoCoinPerPointRatio: '1',
  vkvideoRewardCoins: '',
  vkvideoRewardOnlyWhenLive: false,
  submissionRewardCoinsUpload: '0',
  submissionRewardCoinsPool: '0',
  submissionRewardOnlyWhenLive: false,
};

export function useRewardsSettingsState() {
  const [rewardSettings, setRewardSettings] = useState<RewardSettingsState>(DEFAULT_REWARD_SETTINGS);

  return { rewardSettings, setRewardSettings };
}
