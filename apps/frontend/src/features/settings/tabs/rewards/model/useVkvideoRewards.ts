import { useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

import type { RewardSettingsState } from '@/features/settings/tabs/rewards/types';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';

import { parseIntSafe } from '@/features/settings/tabs/rewards/utils';
import { toApiError } from '@/shared/api/toApiError';
import { ensureMinDuration } from '@/shared/lib/ensureMinDuration';

type UseVkvideoRewardsParams = {
  rewardSettings: RewardSettingsState;
  setRewardSettings: Dispatch<SetStateAction<RewardSettingsState>>;
  channelSlug: string | null | undefined;
  settingsLoadedRef: MutableRefObject<string | null>;
  lastSavedVkvideoRef: MutableRefObject<string | null>;
};

export function useVkvideoRewards({
  rewardSettings,
  setRewardSettings,
  channelSlug,
  settingsLoadedRef,
  lastSavedVkvideoRef,
}: UseVkvideoRewardsParams) {
  const { t } = useTranslation();
  const [vkvideoLastErrorRequestId, setVkvideoLastErrorRequestId] = useState<string | null>(null);
  const [savingVkvideoReward, setSavingVkvideoReward] = useState(false);
  const [vkvideoSavedPulse, setVkvideoSavedPulse] = useState(false);
  const saveVkvideoTimerRef = useRef<number | null>(null);

  const handleSaveVkvideoReward = useCallback(async () => {
    const startedAt = Date.now();
    setSavingVkvideoReward(true);
    try {
      const { api } = await import('@/lib/api');
      const enabled = !!rewardSettings.vkvideoRewardEnabled;

      const effectiveRatioStr =
        enabled && !String(rewardSettings.vkvideoCoinPerPointRatio || '').trim() ? '1' : rewardSettings.vkvideoCoinPerPointRatio;
      if (effectiveRatioStr !== rewardSettings.vkvideoCoinPerPointRatio) {
        setRewardSettings((p) => ({ ...p, vkvideoCoinPerPointRatio: effectiveRatioStr }));
      }

      const ratio = parseIntSafe(String(effectiveRatioStr || '1')) ?? 1;
      const coins = String(rewardSettings.vkvideoRewardCoins || '').trim();
      const rewardCoins = coins ? parseIntSafe(coins) : null;
      const rewardIdRaw = String(rewardSettings.vkvideoRewardIdForCoins || '').trim();
      const rewardIdForCoins = rewardIdRaw ? rewardIdRaw : null;

      await api.patch('/streamer/channel/settings', {
        vkvideoRewardEnabled: enabled,
        vkvideoRewardIdForCoins: rewardIdForCoins,
        vkvideoCoinPerPointRatio: ratio,
        vkvideoRewardCoins: rewardCoins,
        vkvideoRewardOnlyWhenLive: !!rewardSettings.vkvideoRewardOnlyWhenLive,
      });

      lastSavedVkvideoRef.current = JSON.stringify({
        vkvideoRewardEnabled: enabled,
        vkvideoRewardIdForCoins: rewardIdForCoins,
        vkvideoCoinPerPointRatio: ratio,
        vkvideoRewardCoins: rewardCoins,
        vkvideoRewardOnlyWhenLive: !!rewardSettings.vkvideoRewardOnlyWhenLive,
      });
      setVkvideoLastErrorRequestId(null);
    } catch (error: unknown) {
      const err = toApiError(error, t('admin.failedToSaveSettings', { defaultValue: 'Failed to save settings' }));
      const { getRequestIdFromError } = await import('@/lib/api');
      const rid = getRequestIdFromError(error);
      setVkvideoLastErrorRequestId(rid);
      toast.error(err.error || err.message);
    } finally {
      await ensureMinDuration(startedAt, 650);
      setSavingVkvideoReward(false);
      setVkvideoSavedPulse(true);
      window.setTimeout(() => setVkvideoSavedPulse(false), 700);
    }
  }, [rewardSettings, setRewardSettings, t, lastSavedVkvideoRef]);

  // Autosave: VKVideo reward fields (debounced)
  useEffect(() => {
    if (!channelSlug) return;
    if (!settingsLoadedRef.current) return;

    const enabled = !!rewardSettings.vkvideoRewardEnabled;
    const ratio = parseIntSafe(String(rewardSettings.vkvideoCoinPerPointRatio || '1')) ?? 1;
    const coins = String(rewardSettings.vkvideoRewardCoins || '').trim();
    const rewardCoins = coins ? parseIntSafe(coins) : null;
    const rewardIdRaw = String(rewardSettings.vkvideoRewardIdForCoins || '').trim();
    const rewardIdForCoins = rewardIdRaw ? rewardIdRaw : null;

    const payload = JSON.stringify({
      vkvideoRewardEnabled: enabled,
      vkvideoRewardIdForCoins: rewardIdForCoins,
      vkvideoCoinPerPointRatio: ratio,
      vkvideoRewardCoins: rewardCoins,
      vkvideoRewardOnlyWhenLive: !!rewardSettings.vkvideoRewardOnlyWhenLive,
    });

    if (payload === lastSavedVkvideoRef.current) return;
    if (saveVkvideoTimerRef.current) window.clearTimeout(saveVkvideoTimerRef.current);
    saveVkvideoTimerRef.current = window.setTimeout(() => {
      void handleSaveVkvideoReward();
    }, 500);

    return () => {
      if (saveVkvideoTimerRef.current) window.clearTimeout(saveVkvideoTimerRef.current);
      saveVkvideoTimerRef.current = null;
    };
  }, [
    rewardSettings.vkvideoRewardEnabled,
    rewardSettings.vkvideoRewardIdForCoins,
    rewardSettings.vkvideoCoinPerPointRatio,
    rewardSettings.vkvideoRewardCoins,
    rewardSettings.vkvideoRewardOnlyWhenLive,
    channelSlug,
    handleSaveVkvideoReward,
    lastSavedVkvideoRef,
    settingsLoadedRef,
  ]);

  return {
    savingVkvideoReward,
    vkvideoSavedPulse,
    vkvideoLastErrorRequestId,
  };
}
