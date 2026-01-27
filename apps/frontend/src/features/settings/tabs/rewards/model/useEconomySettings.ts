import { useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

import type { RewardSettingsState } from '@/features/settings/tabs/rewards/types';
import type { MutableRefObject } from 'react';

import { ensureMinDuration } from '@/shared/lib/ensureMinDuration';

type UseEconomySettingsParams = {
  rewardSettings: RewardSettingsState;
  channelSlug: string | null | undefined;
  settingsLoadedRef: MutableRefObject<string | null>;
  lastSavedEconomyRef: MutableRefObject<string | null>;
};

export function useEconomySettings({
  rewardSettings,
  channelSlug,
  settingsLoadedRef,
  lastSavedEconomyRef,
}: UseEconomySettingsParams) {
  const { t } = useTranslation();
  const [savingEconomy, setSavingEconomy] = useState(false);
  const [economySavedPulse, setEconomySavedPulse] = useState(false);
  const saveTimerRef = useRef<number | null>(null);

  const handleSaveEconomy = useCallback(async () => {
    const startedAt = Date.now();
    setSavingEconomy(true);
    try {
      const memesPerHour = rewardSettings.economyMemesPerHour
        ? parseInt(rewardSettings.economyMemesPerHour, 10)
        : 2;
      const avgMemePrice = rewardSettings.economyAvgMemePriceCoins
        ? parseInt(rewardSettings.economyAvgMemePriceCoins, 10)
        : 100;
      const multiplier = rewardSettings.economyRewardMultiplier
        ? parseFloat(rewardSettings.economyRewardMultiplier)
        : 1;

      if (
        Number.isNaN(memesPerHour) || memesPerHour < 1 || memesPerHour > 10 ||
        Number.isNaN(avgMemePrice) || avgMemePrice < 1 ||
        Number.isNaN(multiplier) || multiplier < 0.5 || multiplier > 2
      ) {
        toast.error(t('economy.invalidSettings', { defaultValue: 'Enter valid economy settings.' }));
        return;
      }

      const { api } = await import('@/lib/api');
      await api.patch('/streamer/channel/settings', {
        economyMemesPerHour: memesPerHour,
        defaultPriceCoins: avgMemePrice,
        economyRewardMultiplier: multiplier,
      });

      lastSavedEconomyRef.current = JSON.stringify({
        economyMemesPerHour: memesPerHour,
        economyAvgMemePriceCoins: avgMemePrice,
        economyRewardMultiplier: multiplier,
      });
    } catch (error: unknown) {
      const apiError = error as { response?: { data?: { error?: string } } };
      const errorMessage = apiError.response?.data?.error || t('admin.failedToSaveSettings') || 'Failed to save settings';
      toast.error(errorMessage);
    } finally {
      await ensureMinDuration(startedAt, 1000);
      setSavingEconomy(false);
      setEconomySavedPulse(true);
      window.setTimeout(() => setEconomySavedPulse(false), 700);
    }
  }, [rewardSettings.economyMemesPerHour, rewardSettings.economyAvgMemePriceCoins, rewardSettings.economyRewardMultiplier, t, lastSavedEconomyRef]);

  useEffect(() => {
    if (!channelSlug) return;
    if (!settingsLoadedRef.current) return;

    const memesPerHour = rewardSettings.economyMemesPerHour
      ? parseInt(rewardSettings.economyMemesPerHour, 10)
      : 2;
    const avgMemePrice = rewardSettings.economyAvgMemePriceCoins
      ? parseInt(rewardSettings.economyAvgMemePriceCoins, 10)
      : 100;
    const multiplier = rewardSettings.economyRewardMultiplier
      ? parseFloat(rewardSettings.economyRewardMultiplier)
      : 1;

    const payload = JSON.stringify({
      economyMemesPerHour: Number.isFinite(memesPerHour) ? memesPerHour : 2,
      economyAvgMemePriceCoins: Number.isFinite(avgMemePrice) ? avgMemePrice : 100,
      economyRewardMultiplier: Number.isFinite(multiplier) ? multiplier : 1,
    });

    if (payload === lastSavedEconomyRef.current) return;
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      void handleSaveEconomy();
    }, 500);

    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    };
  }, [
    rewardSettings.economyMemesPerHour,
    rewardSettings.economyAvgMemePriceCoins,
    rewardSettings.economyRewardMultiplier,
    channelSlug,
    handleSaveEconomy,
    lastSavedEconomyRef,
    settingsLoadedRef,
  ]);

  return {
    savingEconomy,
    economySavedPulse,
  };
}
