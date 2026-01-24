import { useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

import type { RewardSettingsState } from '@/features/settings/tabs/rewards/types';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';

import { ensureMinDuration } from '@/shared/lib/ensureMinDuration';

type UseTwitchRewardsParams = {
  rewardSettings: RewardSettingsState;
  setRewardSettings: Dispatch<SetStateAction<RewardSettingsState>>;
  channelId: string | null | undefined;
  channelSlug: string | null | undefined;
  settingsLoadedRef: MutableRefObject<string | null>;
  lastSavedTwitchRef: MutableRefObject<string | null>;
};

export function useTwitchRewards({
  rewardSettings,
  setRewardSettings,
  channelId,
  channelSlug,
  settingsLoadedRef,
  lastSavedTwitchRef,
}: UseTwitchRewardsParams) {
  const { t } = useTranslation();
  const [twitchRewardEligible, setTwitchRewardEligible] = useState<boolean | null>(null);
  const [eligibilityLoading, setEligibilityLoading] = useState(false);
  const [lastErrorRequestId, setLastErrorRequestId] = useState<string | null>(null);
  const [savingTwitchReward, setSavingTwitchReward] = useState(false);
  const [twitchSavedPulse, setTwitchSavedPulse] = useState(false);
  const saveTwitchTimerRef = useRef<number | null>(null);

  const handleSaveTwitchReward = useCallback(async () => {
    const startedAt = Date.now();
    setSavingTwitchReward(true);
    try {
      const { api } = await import('@/lib/api');
      // Ensure reward title is never empty when enabling (prevents 400s and creates a good default UX).
      const effectiveTitle =
        rewardSettings.rewardEnabled && !rewardSettings.rewardTitle.trim()
          ? t('admin.rewardTitlePlaceholder', { defaultValue: 'Get Coins' })
          : rewardSettings.rewardTitle;

      // Ensure reward cost/coins are never empty when enabling (prevents 400s; default 1000/1000).
      const effectiveCostStr =
        rewardSettings.rewardEnabled && !String(rewardSettings.rewardCost || '').trim() ? '1000' : rewardSettings.rewardCost;
      const effectiveCoinsStr =
        rewardSettings.rewardEnabled && !String(rewardSettings.rewardCoins || '').trim() ? '1000' : rewardSettings.rewardCoins;

      if (
        effectiveTitle !== rewardSettings.rewardTitle ||
        effectiveCostStr !== rewardSettings.rewardCost ||
        effectiveCoinsStr !== rewardSettings.rewardCoins
      ) {
        setRewardSettings((p) => ({
          ...p,
          rewardTitle: effectiveTitle,
          rewardCost: effectiveCostStr,
          rewardCoins: effectiveCoinsStr,
        }));
      }
      await api.patch('/streamer/channel/settings', {
        // Twitch reward only (do NOT include submissionRewardCoins here)
        rewardIdForCoins: rewardSettings.rewardIdForCoins || null,
        rewardEnabled: rewardSettings.rewardEnabled,
        rewardTitle: effectiveTitle || null,
        rewardCost: effectiveCostStr ? parseInt(effectiveCostStr, 10) : null,
        rewardCoins: effectiveCoinsStr ? parseInt(effectiveCoinsStr, 10) : null,
        rewardOnlyWhenLive: !!rewardSettings.rewardOnlyWhenLive,
      });
      lastSavedTwitchRef.current = JSON.stringify({
        rewardIdForCoins: rewardSettings.rewardIdForCoins || null,
        rewardEnabled: rewardSettings.rewardEnabled,
        rewardTitle: effectiveTitle || null,
        rewardCost: effectiveCostStr ? parseInt(effectiveCostStr, 10) : null,
        rewardCoins: effectiveCoinsStr ? parseInt(effectiveCoinsStr, 10) : null,
        rewardOnlyWhenLive: !!rewardSettings.rewardOnlyWhenLive,
      });
      setLastErrorRequestId(null);
    } catch (error: unknown) {
      const apiError = error as { response?: { status?: number; data?: { error?: string; errorCode?: string } } };
      const code = apiError.response?.data?.errorCode;
      const raw = apiError.response?.data?.error || '';
      const { getRequestIdFromError } = await import('@/lib/api');
      const rid = getRequestIdFromError(error);
      setLastErrorRequestId(rid);

      if (code === 'TWITCH_REWARD_NOT_AVAILABLE' || raw.includes("doesn't have partner") || raw.includes('affiliate')) {
        toast.error(
          t('admin.twitchRewardNotAvailable', { defaultValue: 'This Twitch reward is available only for affiliate/partner channels.' }),
        );
        // Ensure UI doesn't stay enabled after a failed enable attempt.
        setRewardSettings((p) => ({ ...p, rewardEnabled: false }));
      } else if (code === 'REWARD_COST_COINS_REQUIRED' || raw.includes('Reward cost and coins are required')) {
        toast.error(t('admin.rewardCostCoinsRequired', { defaultValue: 'Reward cost and coins are required.' }));
      } else {
        const errorMessage = raw || t('admin.failedToSaveSettings') || 'Failed to save settings';
        toast.error(errorMessage);
      }

      if (apiError.response?.data && typeof apiError.response.data === 'object' && 'requiresReauth' in apiError.response.data) {
        setTimeout(() => {
          if (window.confirm(t('admin.requiresReauth') || 'You need to log out and log in again to enable Twitch rewards. Log out now?')) {
            window.location.href = '/';
          }
        }, 2000);
      }
    } finally {
      await ensureMinDuration(startedAt, 1000);
      setSavingTwitchReward(false);
      setTwitchSavedPulse(true);
      window.setTimeout(() => setTwitchSavedPulse(false), 700);
    }
  }, [rewardSettings, setRewardSettings, t, lastSavedTwitchRef]);

  // Check Twitch reward eligibility (affiliate/partner) to hide/disable reward UI.
  useEffect(() => {
    if (!channelId) return;
    let cancelled = false;
    (async () => {
      try {
        setEligibilityLoading(true);
        const { api } = await import('@/lib/api');
        const res = await api.get<{ eligible: boolean | null; broadcasterType?: string | null; checkedBroadcasterId?: string; reason?: string }>(
          '/streamer/twitch/reward/eligibility',
          { timeout: 15000 },
        );
        if (cancelled) return;
        // eligible can be null ("unknown") on beta when Twitch doesn't return channel info.
        setTwitchRewardEligible(res?.eligible === null ? null : !!res?.eligible);
        setLastErrorRequestId(null);
      } catch {
        if (!cancelled) setTwitchRewardEligible(null);
      } finally {
        if (!cancelled) setEligibilityLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [channelId]);

  // Autosave: Twitch reward fields (debounced)
  useEffect(() => {
    if (!channelSlug) return;
    if (!settingsLoadedRef.current) return;

    const payload = JSON.stringify({
      rewardIdForCoins: rewardSettings.rewardIdForCoins || null,
      rewardEnabled: rewardSettings.rewardEnabled,
      rewardTitle: rewardSettings.rewardTitle || null,
      rewardCost: rewardSettings.rewardCost ? parseInt(rewardSettings.rewardCost, 10) : null,
      rewardCoins: rewardSettings.rewardCoins ? parseInt(rewardSettings.rewardCoins, 10) : null,
      rewardOnlyWhenLive: !!rewardSettings.rewardOnlyWhenLive,
    });

    if (payload === lastSavedTwitchRef.current) return;
    if (saveTwitchTimerRef.current) window.clearTimeout(saveTwitchTimerRef.current);
    saveTwitchTimerRef.current = window.setTimeout(() => {
      void handleSaveTwitchReward();
    }, 500);

    return () => {
      if (saveTwitchTimerRef.current) window.clearTimeout(saveTwitchTimerRef.current);
      saveTwitchTimerRef.current = null;
    };
  }, [
    rewardSettings.rewardIdForCoins,
    rewardSettings.rewardEnabled,
    rewardSettings.rewardTitle,
    rewardSettings.rewardCost,
    rewardSettings.rewardCoins,
    rewardSettings.rewardOnlyWhenLive,
    channelSlug,
    handleSaveTwitchReward,
    lastSavedTwitchRef,
    settingsLoadedRef,
  ]);

  const clearLastErrorRequestId = useCallback(() => {
    setLastErrorRequestId(null);
  }, []);

  return {
    savingTwitchReward,
    twitchSavedPulse,
    eligibilityLoading,
    twitchRewardEligible,
    lastErrorRequestId,
    clearLastErrorRequestId,
  };
}
