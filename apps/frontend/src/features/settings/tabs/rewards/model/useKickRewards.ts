import { useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

import type { RewardSettingsState } from '@/features/settings/tabs/rewards/types';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';

import { parseIntSafe } from '@/features/settings/tabs/rewards/utils';
import { toApiError } from '@/shared/api/toApiError';
import { ensureMinDuration } from '@/shared/lib/ensureMinDuration';

type UseKickRewardsParams = {
  rewardSettings: RewardSettingsState;
  setRewardSettings: Dispatch<SetStateAction<RewardSettingsState>>;
  channelSlug: string | null | undefined;
  settingsLoadedRef: MutableRefObject<string | null>;
  lastSavedKickRef: MutableRefObject<string | null>;
};

export function useKickRewards({
  rewardSettings,
  setRewardSettings,
  channelSlug,
  settingsLoadedRef,
  lastSavedKickRef,
}: UseKickRewardsParams) {
  const { t } = useTranslation();
  const [kickLastErrorRequestId, setKickLastErrorRequestId] = useState<string | null>(null);
  const [kickBackendUnsupported, setKickBackendUnsupported] = useState(false);
  const [savingKickReward, setSavingKickReward] = useState(false);
  const [kickSavedPulse, setKickSavedPulse] = useState(false);
  const saveKickTimerRef = useRef<number | null>(null);

  const handleSaveKickReward = useCallback(async () => {
    const startedAt = Date.now();
    setSavingKickReward(true);
    try {
      const { api } = await import('@/lib/api');

      const enabled = !!rewardSettings.kickRewardEnabled;
      const effectiveRatioStr =
        enabled && !String(rewardSettings.kickCoinPerPointRatio || '').trim() ? '1' : rewardSettings.kickCoinPerPointRatio;
      if (effectiveRatioStr !== rewardSettings.kickCoinPerPointRatio) {
        setRewardSettings((p) => ({ ...p, kickCoinPerPointRatio: effectiveRatioStr }));
      }

      const ratio = parseIntSafe(String(effectiveRatioStr || '1')) ?? 1;
      const coins = String(rewardSettings.kickRewardCoins || '').trim();
      const rewardCoins = coins ? parseIntSafe(coins) : null;
      const rewardIdRaw = String(rewardSettings.kickRewardIdForCoins || '').trim();
      const rewardIdForCoins = rewardIdRaw ? rewardIdRaw : null;

      await api.patch('/streamer/channel/settings', {
        kickRewardEnabled: enabled,
        kickRewardIdForCoins: rewardIdForCoins,
        kickCoinPerPointRatio: ratio,
        kickRewardCoins: rewardCoins,
        kickRewardOnlyWhenLive: !!rewardSettings.kickRewardOnlyWhenLive,
      });

      lastSavedKickRef.current = JSON.stringify({
        kickRewardEnabled: enabled,
        kickRewardIdForCoins: rewardIdForCoins,
        kickCoinPerPointRatio: ratio,
        kickRewardCoins: rewardCoins,
        kickRewardOnlyWhenLive: !!rewardSettings.kickRewardOnlyWhenLive,
      });
      setKickLastErrorRequestId(null);
    } catch (error: unknown) {
      const err = toApiError(error, t('admin.failedToSaveSettings', { defaultValue: 'Failed to save settings' }));
      const { getRequestIdFromError } = await import('@/lib/api');
      const rid = getRequestIdFromError(error);
      setKickLastErrorRequestId(rid);

      const msg = String(err.error || '').toLowerCase();
      if (msg.includes('kickrewardenabled') && msg.includes('does not exist')) {
        // Backend DB is not migrated yet; prevent repeated autosaves and keep UI consistent.
        setKickBackendUnsupported(true);
        toast.error(
          t('admin.kickBackendNotReady', {
            defaultValue: 'Kick rewards are temporarily unavailable (backend database is not migrated yet).',
          }),
        );
        setRewardSettings((p) => ({ ...p, kickRewardEnabled: false }));
        return;
      }

      if (err.errorCode === 'KICK_NOT_LINKED') {
        toast.error(
          t('admin.kickNotLinked', {
            defaultValue: 'Kick account is not linked. Link Kick in Settings → Accounts.',
          }),
        );
        setRewardSettings((p) => ({ ...p, kickRewardEnabled: false }));
      } else if (err.errorCode === 'KICK_SCOPE_MISSING_EVENTS_SUBSCRIBE') {
        toast.error(
          t('admin.kickScopeMissingEventsSubscribe', {
            defaultValue: 'Kick permissions missing: events:subscribe. Re-link Kick with the correct scopes.',
          }),
        );
        setRewardSettings((p) => ({ ...p, kickRewardEnabled: false }));
      } else if (err.errorCode === 'KICK_ACCESS_TOKEN_MISSING') {
        toast.error(
          t('admin.kickAccessTokenMissing', {
            defaultValue: 'Kick access token is missing. Re-link Kick account.',
          }),
        );
        setRewardSettings((p) => ({ ...p, kickRewardEnabled: false }));
      } else {
        toast.error(err.error || err.message);
      }
    } finally {
      await ensureMinDuration(startedAt, 650);
      setSavingKickReward(false);
      setKickSavedPulse(true);
      window.setTimeout(() => setKickSavedPulse(false), 700);
    }
  }, [rewardSettings, setRewardSettings, t, lastSavedKickRef]);

  // Autosave: Kick reward fields (debounced)
  useEffect(() => {
    if (!channelSlug) return;
    if (!settingsLoadedRef.current) return;
    if (kickBackendUnsupported) return;

    const enabled = !!rewardSettings.kickRewardEnabled;
    const ratio = parseIntSafe(String(rewardSettings.kickCoinPerPointRatio || '1')) ?? 1;
    const coins = String(rewardSettings.kickRewardCoins || '').trim();
    const rewardCoins = coins ? parseIntSafe(coins) : null;
    const rewardIdRaw = String(rewardSettings.kickRewardIdForCoins || '').trim();
    const rewardIdForCoins = rewardIdRaw ? rewardIdRaw : null;

    const payload = JSON.stringify({
      kickRewardEnabled: enabled,
      kickRewardIdForCoins: rewardIdForCoins,
      kickCoinPerPointRatio: ratio,
      kickRewardCoins: rewardCoins,
      kickRewardOnlyWhenLive: !!rewardSettings.kickRewardOnlyWhenLive,
    });

    if (payload === lastSavedKickRef.current) return;
    if (saveKickTimerRef.current) window.clearTimeout(saveKickTimerRef.current);
    saveKickTimerRef.current = window.setTimeout(() => {
      void handleSaveKickReward();
    }, 500);

    return () => {
      if (saveKickTimerRef.current) window.clearTimeout(saveKickTimerRef.current);
      saveKickTimerRef.current = null;
    };
  }, [
    rewardSettings.kickRewardEnabled,
    rewardSettings.kickRewardIdForCoins,
    rewardSettings.kickCoinPerPointRatio,
    rewardSettings.kickRewardCoins,
    rewardSettings.kickRewardOnlyWhenLive,
    channelSlug,
    handleSaveKickReward,
    kickBackendUnsupported,
    lastSavedKickRef,
    settingsLoadedRef,
  ]);

  return {
    savingKickReward,
    kickSavedPulse,
    kickBackendUnsupported,
    kickLastErrorRequestId,
  };
}
