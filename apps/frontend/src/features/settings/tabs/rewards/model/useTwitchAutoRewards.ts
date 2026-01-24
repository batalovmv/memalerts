import { useCallback, useState } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

import type { TwitchAutoRewardsV1 } from '@/types';
import type { MutableRefObject } from 'react';

import { normalizeTwitchAutoRewards, toRecord } from '@/features/settings/tabs/rewards/utils';
import { toApiError } from '@/shared/api/toApiError';
import { ensureMinDuration } from '@/shared/lib/ensureMinDuration';

type UseTwitchAutoRewardsParams = {
  lastSavedTwitchAutoRewardsRef: MutableRefObject<string | null>;
  onClearRequestId?: () => void;
};

export function useTwitchAutoRewards({ lastSavedTwitchAutoRewardsRef, onClearRequestId }: UseTwitchAutoRewardsParams) {
  const { t } = useTranslation();
  const [twitchAutoRewardsDraft, setTwitchAutoRewardsDraft] = useState<TwitchAutoRewardsV1 | null>(null);
  const [twitchAutoRewardsError, setTwitchAutoRewardsError] = useState<string | null>(null);
  const [savingTwitchAutoRewards, setSavingTwitchAutoRewards] = useState(false);
  const [twitchAutoRewardsSavedPulse, setTwitchAutoRewardsSavedPulse] = useState(false);

  const loadFromSettings = useCallback(async (): Promise<boolean> => {
    try {
      const { api } = await import('@/lib/api');
      const res = await api.patch<unknown>('/streamer/channel/settings', {});
      const rr = toRecord(res);
      const tawRaw = rr ? (rr.twitchAutoRewardsJson ?? rr.twitchAutoRewards ?? null) : null;
      setTwitchAutoRewardsDraft(normalizeTwitchAutoRewards(tawRaw));
      lastSavedTwitchAutoRewardsRef.current = JSON.stringify(tawRaw ?? null);
      return true;
    } catch {
      return false;
    }
  }, [lastSavedTwitchAutoRewardsRef]);

  const applySnapshot = useCallback(
    (raw: unknown) => {
      setTwitchAutoRewardsDraft(normalizeTwitchAutoRewards(raw));
      lastSavedTwitchAutoRewardsRef.current = JSON.stringify(raw ?? null);
    },
    [lastSavedTwitchAutoRewardsRef],
  );

  const saveTwitchAutoRewards = useCallback(
    async (overrideValue?: TwitchAutoRewardsV1 | null) => {
      const startedAt = Date.now();
      setSavingTwitchAutoRewards(true);
      try {
        setTwitchAutoRewardsError(null);
        const value = overrideValue === undefined ? twitchAutoRewardsDraft : overrideValue;
        const payloadStr = JSON.stringify(value ?? null);
        if (payloadStr === lastSavedTwitchAutoRewardsRef.current) {
          return;
        }

        const { api } = await import('@/lib/api');
        const res = await api.patch<unknown>('/streamer/channel/settings', {
          twitchAutoRewards: value,
        });

        const rr = toRecord(res);
        const savedRaw = rr ? (rr.twitchAutoRewardsJson ?? rr.twitchAutoRewards ?? value ?? null) : value ?? null;
        const savedStr = JSON.stringify(savedRaw ?? null);
        lastSavedTwitchAutoRewardsRef.current = savedStr;
        setTwitchAutoRewardsDraft(normalizeTwitchAutoRewards(savedRaw));
        onClearRequestId?.();
      } catch (e) {
        const err = toApiError(e, t('admin.failedToSaveSettings', { defaultValue: 'Failed to save settings' }));
        setTwitchAutoRewardsError(err.message || 'Failed to save settings');
        toast.error(err.message || 'Failed to save settings');
      } finally {
        await ensureMinDuration(startedAt, 650);
        setSavingTwitchAutoRewards(false);
        setTwitchAutoRewardsSavedPulse(true);
        window.setTimeout(() => setTwitchAutoRewardsSavedPulse(false), 700);
      }
    },
    [lastSavedTwitchAutoRewardsRef, onClearRequestId, t, twitchAutoRewardsDraft],
  );

  const clearTwitchAutoRewardsError = useCallback(() => {
    setTwitchAutoRewardsError(null);
  }, []);

  return {
    twitchAutoRewardsDraft,
    setTwitchAutoRewardsDraft,
    clearTwitchAutoRewardsError,
    twitchAutoRewardsError,
    savingTwitchAutoRewards,
    twitchAutoRewardsSavedPulse,
    loadFromSettings,
    applySnapshot,
    saveTwitchAutoRewards,
  };
}
