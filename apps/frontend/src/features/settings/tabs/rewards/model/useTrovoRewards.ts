import { useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

import type { RewardSettingsState } from '@/features/settings/tabs/rewards/types';
import type { MutableRefObject } from 'react';

import { parseIntSafe } from '@/features/settings/tabs/rewards/utils';
import { toApiError } from '@/shared/api/toApiError';
import { ensureMinDuration } from '@/shared/lib/ensureMinDuration';

type UseTrovoRewardsParams = {
  rewardSettings: RewardSettingsState;
  channelSlug: string | null | undefined;
  trovoLinked: boolean;
  settingsLoadedRef: MutableRefObject<string | null>;
  lastSavedTrovoRef: MutableRefObject<string | null>;
};

export function useTrovoRewards({
  rewardSettings,
  channelSlug,
  trovoLinked,
  settingsLoadedRef,
  lastSavedTrovoRef,
}: UseTrovoRewardsParams) {
  const { t } = useTranslation();
  const [savingTrovoReward, setSavingTrovoReward] = useState(false);
  const [trovoSavedPulse, setTrovoSavedPulse] = useState(false);
  const saveTrovoTimerRef = useRef<number | null>(null);

  const handleSaveTrovoReward = useCallback(async () => {
    const startedAt = Date.now();
    setSavingTrovoReward(true);
    try {
      if (!trovoLinked) {
        toast.error(
          t('admin.trovoNotLinked', { defaultValue: 'Trovo account is not linked. Link Trovo in Settings → Accounts.' }),
        );
        return;
      }
      const manaRaw = String(rewardSettings.trovoManaCoinsPerUnit || '').trim();
      const elixirRaw = String(rewardSettings.trovoElixirCoinsPerUnit || '').trim();

      const mana = parseIntSafe(manaRaw || '0') ?? 0;
      const elixir = parseIntSafe(elixirRaw || '0') ?? 0;
      if (!Number.isFinite(mana) || mana < 0 || !Number.isFinite(elixir) || elixir < 0) {
        toast.error(t('admin.invalidTrovoCoinsPerUnit', { defaultValue: 'Введите корректные числа (0 или больше).' }));
        return;
      }

      const { api } = await import('@/lib/api');
      await api.patch('/streamer/channel/settings', {
        trovoManaCoinsPerUnit: mana,
        trovoElixirCoinsPerUnit: elixir,
      });

      lastSavedTrovoRef.current = JSON.stringify({
        trovoManaCoinsPerUnit: mana,
        trovoElixirCoinsPerUnit: elixir,
      });
    } catch (error: unknown) {
      const err = toApiError(error, t('admin.failedToSaveSettings', { defaultValue: 'Failed to save settings' }));
      toast.error(err.message);
    } finally {
      await ensureMinDuration(startedAt, 650);
      setSavingTrovoReward(false);
      setTrovoSavedPulse(true);
      window.setTimeout(() => setTrovoSavedPulse(false), 700);
    }
  }, [rewardSettings, t, trovoLinked, lastSavedTrovoRef]);

  // Autosave: Trovo reward fields (debounced)
  useEffect(() => {
    if (!channelSlug) return;
    if (!settingsLoadedRef.current) return;
    if (!trovoLinked) return;

    const mana = parseIntSafe(String(rewardSettings.trovoManaCoinsPerUnit || '0')) ?? 0;
    const elixir = parseIntSafe(String(rewardSettings.trovoElixirCoinsPerUnit || '0')) ?? 0;

    const payload = JSON.stringify({
      trovoManaCoinsPerUnit: Number.isFinite(mana) ? mana : 0,
      trovoElixirCoinsPerUnit: Number.isFinite(elixir) ? elixir : 0,
    });

    if (payload === lastSavedTrovoRef.current) return;
    if (saveTrovoTimerRef.current) window.clearTimeout(saveTrovoTimerRef.current);
    saveTrovoTimerRef.current = window.setTimeout(() => {
      void handleSaveTrovoReward();
    }, 500);

    return () => {
      if (saveTrovoTimerRef.current) window.clearTimeout(saveTrovoTimerRef.current);
      saveTrovoTimerRef.current = null;
    };
  }, [
    rewardSettings.trovoManaCoinsPerUnit,
    rewardSettings.trovoElixirCoinsPerUnit,
    channelSlug,
    handleSaveTrovoReward,
    lastSavedTrovoRef,
    settingsLoadedRef,
    trovoLinked,
  ]);

  return {
    savingTrovoReward,
    trovoSavedPulse,
  };
}
