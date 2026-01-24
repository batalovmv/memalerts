import { useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

import type { RewardSettingsState } from '@/features/settings/tabs/rewards/types';
import type { MutableRefObject } from 'react';

import { ensureMinDuration } from '@/shared/lib/ensureMinDuration';

type UseSubmissionsRewardsParams = {
  rewardSettings: RewardSettingsState;
  channelSlug: string | null | undefined;
  settingsLoadedRef: MutableRefObject<string | null>;
  lastSavedApprovedRef: MutableRefObject<string | null>;
};

export function useSubmissionsRewards({
  rewardSettings,
  channelSlug,
  settingsLoadedRef,
  lastSavedApprovedRef,
}: UseSubmissionsRewardsParams) {
  const { t } = useTranslation();
  const [savingApprovedMemeReward, setSavingApprovedMemeReward] = useState(false);
  const [approvedSavedPulse, setApprovedSavedPulse] = useState(false);
  const saveApprovedTimerRef = useRef<number | null>(null);
  const lastApprovedNonZeroRef = useRef<number>(100);
  const lastApprovedNonZeroPoolRef = useRef<number>(100);

  // Track last non-zero value for the approved meme reward toggle.
  useEffect(() => {
    const uploadCoins = rewardSettings.submissionRewardCoinsUpload ? parseInt(rewardSettings.submissionRewardCoinsUpload, 10) : 0;
    if (Number.isFinite(uploadCoins) && uploadCoins > 0) {
      lastApprovedNonZeroRef.current = uploadCoins;
    }
    const poolCoins = rewardSettings.submissionRewardCoinsPool ? parseInt(rewardSettings.submissionRewardCoinsPool, 10) : 0;
    if (Number.isFinite(poolCoins) && poolCoins > 0) {
      lastApprovedNonZeroPoolRef.current = poolCoins;
    }
  }, [rewardSettings.submissionRewardCoinsUpload, rewardSettings.submissionRewardCoinsPool]);

  const handleSaveApprovedMemeReward = useCallback(async () => {
    const startedAt = Date.now();
    setSavingApprovedMemeReward(true);
    try {
      const uploadCoins = rewardSettings.submissionRewardCoinsUpload
        ? parseInt(rewardSettings.submissionRewardCoinsUpload, 10)
        : 0;
      const poolCoins = rewardSettings.submissionRewardCoinsPool ? parseInt(rewardSettings.submissionRewardCoinsPool, 10) : 0;

      if (Number.isNaN(uploadCoins) || uploadCoins < 0 || Number.isNaN(poolCoins) || poolCoins < 0) {
        toast.error(t('admin.invalidSubmissionRewardCoins', 'Введите корректное число (0 или больше)'));
        return;
      }
      const { api } = await import('@/lib/api');
      await api.patch('/streamer/channel/settings', {
        // Approved meme reward only (do NOT include Twitch reward fields here)
        submissionRewardCoinsUpload: uploadCoins,
        submissionRewardCoinsPool: poolCoins,
        submissionRewardOnlyWhenLive: !!rewardSettings.submissionRewardOnlyWhenLive,
      });
      lastSavedApprovedRef.current = JSON.stringify({
        submissionRewardCoinsUpload: uploadCoins,
        submissionRewardCoinsPool: poolCoins,
        submissionRewardOnlyWhenLive: !!rewardSettings.submissionRewardOnlyWhenLive,
      });
    } catch (error: unknown) {
      const apiError = error as { response?: { data?: { error?: string } } };
      const errorMessage = apiError.response?.data?.error || t('admin.failedToSaveSettings') || 'Failed to save settings';
      toast.error(errorMessage);
    } finally {
      await ensureMinDuration(startedAt, 1000);
      setSavingApprovedMemeReward(false);
      setApprovedSavedPulse(true);
      window.setTimeout(() => setApprovedSavedPulse(false), 700);
    }
  }, [rewardSettings, t, lastSavedApprovedRef]);

  // Autosave: approved meme rewards (debounced)
  useEffect(() => {
    if (!channelSlug) return;
    if (!settingsLoadedRef.current) return;

    const uploadCoins = rewardSettings.submissionRewardCoinsUpload
      ? parseInt(rewardSettings.submissionRewardCoinsUpload, 10)
      : 0;
    const poolCoins = rewardSettings.submissionRewardCoinsPool ? parseInt(rewardSettings.submissionRewardCoinsPool, 10) : 0;

    const payload = JSON.stringify({
      submissionRewardCoinsUpload: Number.isFinite(uploadCoins) ? uploadCoins : 0,
      submissionRewardCoinsPool: Number.isFinite(poolCoins) ? poolCoins : 0,
      submissionRewardOnlyWhenLive: !!rewardSettings.submissionRewardOnlyWhenLive,
    });

    if (payload === lastSavedApprovedRef.current) return;
    if (saveApprovedTimerRef.current) window.clearTimeout(saveApprovedTimerRef.current);
    saveApprovedTimerRef.current = window.setTimeout(() => {
      void handleSaveApprovedMemeReward();
    }, 500);

    return () => {
      if (saveApprovedTimerRef.current) window.clearTimeout(saveApprovedTimerRef.current);
      saveApprovedTimerRef.current = null;
    };
  }, [
    rewardSettings.submissionRewardCoinsUpload,
    rewardSettings.submissionRewardCoinsPool,
    rewardSettings.submissionRewardOnlyWhenLive,
    channelSlug,
    handleSaveApprovedMemeReward,
    lastSavedApprovedRef,
    settingsLoadedRef,
  ]);

  return {
    savingApprovedMemeReward,
    approvedSavedPulse,
    restoreUploadCoins: lastApprovedNonZeroRef.current,
    restorePoolCoins: lastApprovedNonZeroPoolRef.current,
  };
}
