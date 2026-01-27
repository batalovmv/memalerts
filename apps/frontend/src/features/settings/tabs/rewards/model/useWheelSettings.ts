import { useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

import type { RewardSettingsState } from '@/features/settings/tabs/rewards/types';
import type { MutableRefObject } from 'react';

import { ensureMinDuration } from '@/shared/lib/ensureMinDuration';

const clampMultiplier = (value: number): number => {
  if (!Number.isFinite(value)) return 1;
  return Math.min(2, Math.max(0.5, value));
};

type UseWheelSettingsParams = {
  rewardSettings: RewardSettingsState;
  channelSlug: string | null | undefined;
  settingsLoadedRef: MutableRefObject<string | null>;
  lastSavedWheelRef: MutableRefObject<string | null>;
};

export function useWheelSettings({
  rewardSettings,
  channelSlug,
  settingsLoadedRef,
  lastSavedWheelRef,
}: UseWheelSettingsParams) {
  const { t } = useTranslation();
  const [savingWheel, setSavingWheel] = useState(false);
  const [wheelSavedPulse, setWheelSavedPulse] = useState(false);
  const saveTimerRef = useRef<number | null>(null);

  const handleSaveWheel = useCallback(async () => {
    const startedAt = Date.now();
    setSavingWheel(true);
    try {
      const enabled = !!rewardSettings.wheelEnabled;
      const costRaw = rewardSettings.wheelPaidSpinCostCoins.trim();
      const costParsed = costRaw ? parseInt(costRaw, 10) : null;
      const prizeMultiplierParsed = rewardSettings.wheelPrizeMultiplier
        ? parseFloat(rewardSettings.wheelPrizeMultiplier)
        : 1;
      const prizeMultiplier = clampMultiplier(prizeMultiplierParsed);

      if (costParsed !== null && (Number.isNaN(costParsed) || costParsed < 0)) {
        toast.error(t('wheel.invalidCost', { defaultValue: 'Enter a valid paid spin cost.' }));
        return;
      }

      const { api } = await import('@/lib/api');
      await api.patch('/streamer/wheel/settings', {
        enabled,
        paidSpinCostCoins: costParsed,
        prizeMultiplier,
      });

      lastSavedWheelRef.current = JSON.stringify({
        wheelEnabled: enabled,
        wheelPaidSpinCostCoins: costParsed,
        wheelPrizeMultiplier: prizeMultiplier,
      });
    } catch (error: unknown) {
      const apiError = error as { response?: { data?: { error?: string } } };
      const errorMessage = apiError.response?.data?.error || t('admin.failedToSaveSettings') || 'Failed to save settings';
      toast.error(errorMessage);
    } finally {
      await ensureMinDuration(startedAt, 1000);
      setSavingWheel(false);
      setWheelSavedPulse(true);
      window.setTimeout(() => setWheelSavedPulse(false), 700);
    }
  }, [rewardSettings.wheelEnabled, rewardSettings.wheelPaidSpinCostCoins, rewardSettings.wheelPrizeMultiplier, t, lastSavedWheelRef]);

  useEffect(() => {
    if (!channelSlug) return;
    if (!settingsLoadedRef.current) return;

    const enabled = !!rewardSettings.wheelEnabled;
    const costParsed = rewardSettings.wheelPaidSpinCostCoins.trim()
      ? parseInt(rewardSettings.wheelPaidSpinCostCoins, 10)
      : null;
    const prizeMultiplierParsed = rewardSettings.wheelPrizeMultiplier
      ? parseFloat(rewardSettings.wheelPrizeMultiplier)
      : 1;
    const prizeMultiplier = clampMultiplier(prizeMultiplierParsed);

    const payload = JSON.stringify({
      wheelEnabled: enabled,
      wheelPaidSpinCostCoins: Number.isFinite(costParsed as number) ? costParsed : null,
      wheelPrizeMultiplier: prizeMultiplier,
    });

    if (payload === lastSavedWheelRef.current) return;
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      void handleSaveWheel();
    }, 500);

    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    };
  }, [
    rewardSettings.wheelEnabled,
    rewardSettings.wheelPaidSpinCostCoins,
    rewardSettings.wheelPrizeMultiplier,
    channelSlug,
    handleSaveWheel,
    lastSavedWheelRef,
    settingsLoadedRef,
  ]);

  return {
    savingWheel,
    wheelSavedPulse,
  };
}
