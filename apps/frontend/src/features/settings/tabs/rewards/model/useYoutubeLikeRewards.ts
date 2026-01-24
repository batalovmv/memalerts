import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

import type { RewardSettingsState } from '@/features/settings/tabs/rewards/types';
import type { MutableRefObject } from 'react';

import { parseIntSafe } from '@/features/settings/tabs/rewards/utils';
import { toApiError } from '@/shared/api/toApiError';
import { ensureMinDuration } from '@/shared/lib/ensureMinDuration';

type UseYoutubeLikeRewardsParams = {
  rewardSettings: RewardSettingsState;
  channelSlug: string | null | undefined;
  settingsLoadedRef: MutableRefObject<string | null>;
  lastSavedYoutubeLikeRef: MutableRefObject<string | null>;
};

export function useYoutubeLikeRewards({
  rewardSettings,
  channelSlug,
  settingsLoadedRef,
  lastSavedYoutubeLikeRef,
}: UseYoutubeLikeRewardsParams) {
  const { t } = useTranslation();
  const [savingYoutubeLikeReward, setSavingYoutubeLikeReward] = useState(false);
  const [youtubeLikeSavedPulse, setYoutubeLikeSavedPulse] = useState(false);
  const saveYoutubeLikeTimerRef = useRef<number | null>(null);

  // Autosave: YouTube like reward fields (debounced)
  useEffect(() => {
    if (!channelSlug) return;
    if (!settingsLoadedRef.current) return;

    const enabled = !!rewardSettings.youtubeLikeRewardEnabled;
    const coins = parseIntSafe(String(rewardSettings.youtubeLikeRewardCoins || '0')) ?? 0;
    const onlyWhenLive = !!rewardSettings.youtubeLikeRewardOnlyWhenLive;

    const payload = JSON.stringify({
      youtubeLikeRewardEnabled: enabled,
      youtubeLikeRewardCoins: coins,
      youtubeLikeRewardOnlyWhenLive: onlyWhenLive,
    });

    if (payload === lastSavedYoutubeLikeRef.current) return;
    if (saveYoutubeLikeTimerRef.current) window.clearTimeout(saveYoutubeLikeTimerRef.current);
    saveYoutubeLikeTimerRef.current = window.setTimeout(async () => {
      const startedAt = Date.now();
      setSavingYoutubeLikeReward(true);
      try {
        const { api } = await import('@/lib/api');
        await api.patch('/streamer/channel/settings', {
          youtubeLikeRewardEnabled: enabled,
          youtubeLikeRewardCoins: coins,
          youtubeLikeRewardOnlyWhenLive: onlyWhenLive,
        });
        lastSavedYoutubeLikeRef.current = payload;
      } catch (error: unknown) {
        const err = toApiError(error, t('admin.failedToSaveSettings', { defaultValue: 'Failed to save settings' }));
        toast.error(err.error || err.message);
      } finally {
        await ensureMinDuration(startedAt, 650);
        setSavingYoutubeLikeReward(false);
        setYoutubeLikeSavedPulse(true);
        window.setTimeout(() => setYoutubeLikeSavedPulse(false), 700);
      }
    }, 500);

    return () => {
      if (saveYoutubeLikeTimerRef.current) window.clearTimeout(saveYoutubeLikeTimerRef.current);
      saveYoutubeLikeTimerRef.current = null;
    };
  }, [
    rewardSettings.youtubeLikeRewardEnabled,
    rewardSettings.youtubeLikeRewardCoins,
    rewardSettings.youtubeLikeRewardOnlyWhenLive,
    channelSlug,
    lastSavedYoutubeLikeRef,
    settingsLoadedRef,
    t,
  ]);

  return {
    savingYoutubeLikeReward,
    youtubeLikeSavedPulse,
  };
}
