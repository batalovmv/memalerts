import { useCallback, useEffect } from 'react';

import type { RewardsSettingsSaveRefs } from '@/features/settings/tabs/rewards/model/useRewardsSettingsSaveRefs';
import type { RewardSettingsState } from '@/features/settings/tabs/rewards/types';
import type { Dispatch, SetStateAction } from 'react';

import { getBoolean, toRecord } from '@/features/settings/tabs/rewards/utils';

type UseRewardsSettingsLoaderParams = {
  user: {
    channelId?: string | null;
    channel?: { slug?: string | null };
  } | null;
  getChannelData: (slug: string) => Promise<unknown>;
  getCachedChannelData: (slug: string) => unknown;
  setRewardSettings: Dispatch<SetStateAction<RewardSettingsState>>;
  applyBoostySnapshot: (source: unknown) => void;
  applyTwitchAutoRewardsSnapshot: (raw: unknown) => void;
  loadTwitchAutoRewardsFromSettings: () => Promise<boolean>;
  saveRefs: RewardsSettingsSaveRefs;
};

export function useRewardsSettingsLoader({
  user,
  getChannelData,
  getCachedChannelData,
  setRewardSettings,
  applyBoostySnapshot,
  applyTwitchAutoRewardsSnapshot,
  loadTwitchAutoRewardsFromSettings,
  saveRefs,
}: UseRewardsSettingsLoaderParams) {
  const channelSlug = user?.channel?.slug ?? null;
  const loadRewardSettings = useCallback(async () => {
    if (!channelSlug) return;

    if (saveRefs.settingsLoadedRef.current === channelSlug) {
      return;
    }

    const applyFromSource = async (source: unknown) => {
      const loaded = await loadTwitchAutoRewardsFromSettings();
      const sourceRec = toRecord(source);
      if (!loaded) {
        const tawRaw = sourceRec ? (sourceRec.twitchAutoRewards ?? sourceRec.twitchAutoRewardsJson ?? null) : null;
        applyTwitchAutoRewardsSnapshot(tawRaw);
      }

      if (!sourceRec) return;
      const data = sourceRec;
      const asBoolean = (value: unknown): boolean => (typeof value === 'boolean' ? value : Boolean(value));
      const asNumber = (value: unknown): number | null => (typeof value === 'number' ? value : null);
      const asNumberOrZero = (value: unknown): number => (typeof value === 'number' ? value : 0);
      const asNumberStringOrEmpty = (value: unknown): string => (typeof value === 'number' && value ? String(value) : '');
      const asString = (value: unknown): string => (value ? String(value) : '');
      const asNonEmptyStringOrNull = (value: unknown): string | null =>
        typeof value === 'string' && value.trim() ? value : null;

      const legacyCoins = asNumberOrZero(data.submissionRewardCoins);
      const uploadCoins = asNumber(data.submissionRewardCoinsUpload) ?? legacyCoins;
      const poolCoins = asNumber(data.submissionRewardCoinsPool) ?? legacyCoins;

      setRewardSettings({
        youtubeLikeRewardEnabled: getBoolean(data, 'youtubeLikeRewardEnabled') ?? false,
        youtubeLikeRewardCoins:
          typeof data.youtubeLikeRewardCoins === 'number' ? String(data.youtubeLikeRewardCoins) : '10',
        youtubeLikeRewardOnlyWhenLive: getBoolean(data, 'youtubeLikeRewardOnlyWhenLive') ?? true,
        rewardIdForCoins: asString(data.rewardIdForCoins),
        rewardEnabled: asBoolean(data.rewardEnabled),
        rewardTitle: asString(data.rewardTitle),
        rewardCost: asNumberStringOrEmpty(data.rewardCost),
        rewardCoins: asNumberStringOrEmpty(data.rewardCoins),
        rewardOnlyWhenLive: getBoolean(data, 'rewardOnlyWhenLive') ?? false,
        kickRewardEnabled: getBoolean(data, 'kickRewardEnabled') ?? false,
        kickRewardIdForCoins: typeof data.kickRewardIdForCoins === 'string' ? String(data.kickRewardIdForCoins) : '',
        kickCoinPerPointRatio:
          typeof data.kickCoinPerPointRatio === 'number' ? String(data.kickCoinPerPointRatio) : '1',
        kickRewardCoins: typeof data.kickRewardCoins === 'number' ? String(data.kickRewardCoins) : '',
        kickRewardOnlyWhenLive: getBoolean(data, 'kickRewardOnlyWhenLive') ?? false,
        trovoManaCoinsPerUnit:
          typeof data.trovoManaCoinsPerUnit === 'number' ? String(data.trovoManaCoinsPerUnit) : '0',
        trovoElixirCoinsPerUnit:
          typeof data.trovoElixirCoinsPerUnit === 'number' ? String(data.trovoElixirCoinsPerUnit) : '0',
        vkvideoRewardEnabled: getBoolean(data, 'vkvideoRewardEnabled') ?? false,
        vkvideoRewardIdForCoins: typeof data.vkvideoRewardIdForCoins === 'string' ? String(data.vkvideoRewardIdForCoins) : '',
        vkvideoCoinPerPointRatio:
          typeof data.vkvideoCoinPerPointRatio === 'number' ? String(data.vkvideoCoinPerPointRatio) : '1',
        vkvideoRewardCoins: typeof data.vkvideoRewardCoins === 'number' ? String(data.vkvideoRewardCoins) : '',
        vkvideoRewardOnlyWhenLive: getBoolean(data, 'vkvideoRewardOnlyWhenLive') ?? false,
        submissionRewardCoinsUpload: String(uploadCoins ?? 0),
        submissionRewardCoinsPool: String(poolCoins ?? 0),
        submissionRewardOnlyWhenLive: getBoolean(data, 'submissionRewardOnlyWhenLive') ?? false,
      });

      saveRefs.lastSavedTwitchRef.current = JSON.stringify({
        rewardIdForCoins: asNonEmptyStringOrNull(data.rewardIdForCoins),
        rewardEnabled: asBoolean(data.rewardEnabled),
        rewardTitle: asNonEmptyStringOrNull(data.rewardTitle),
        rewardCost: asNumber(data.rewardCost),
        rewardCoins: asNumber(data.rewardCoins),
        rewardOnlyWhenLive: getBoolean(data, 'rewardOnlyWhenLive') ?? false,
      });
      saveRefs.lastSavedYoutubeLikeRef.current = JSON.stringify({
        youtubeLikeRewardEnabled: getBoolean(data, 'youtubeLikeRewardEnabled') ?? false,
        youtubeLikeRewardCoins: typeof data.youtubeLikeRewardCoins === 'number' ? data.youtubeLikeRewardCoins : 0,
        youtubeLikeRewardOnlyWhenLive: getBoolean(data, 'youtubeLikeRewardOnlyWhenLive') ?? true,
      });
      saveRefs.lastSavedApprovedRef.current = JSON.stringify({
        submissionRewardCoinsUpload: uploadCoins ?? 0,
        submissionRewardCoinsPool: poolCoins ?? 0,
        submissionRewardOnlyWhenLive: getBoolean(data, 'submissionRewardOnlyWhenLive') ?? false,
      });
      saveRefs.lastSavedKickRef.current = JSON.stringify({
        kickRewardEnabled: getBoolean(data, 'kickRewardEnabled') ?? false,
        kickRewardIdForCoins: typeof data.kickRewardIdForCoins === 'string' ? String(data.kickRewardIdForCoins) : null,
        kickCoinPerPointRatio: typeof data.kickCoinPerPointRatio === 'number' ? data.kickCoinPerPointRatio : 1,
        kickRewardCoins: typeof data.kickRewardCoins === 'number' ? data.kickRewardCoins : null,
        kickRewardOnlyWhenLive: getBoolean(data, 'kickRewardOnlyWhenLive') ?? false,
      });
      saveRefs.lastSavedTrovoRef.current = JSON.stringify({
        trovoManaCoinsPerUnit: typeof data.trovoManaCoinsPerUnit === 'number' ? data.trovoManaCoinsPerUnit : 0,
        trovoElixirCoinsPerUnit: typeof data.trovoElixirCoinsPerUnit === 'number' ? data.trovoElixirCoinsPerUnit : 0,
      });
      saveRefs.lastSavedVkvideoRef.current = JSON.stringify({
        vkvideoRewardEnabled: getBoolean(data, 'vkvideoRewardEnabled') ?? false,
        vkvideoRewardIdForCoins:
          typeof data.vkvideoRewardIdForCoins === 'string' ? String(data.vkvideoRewardIdForCoins) : null,
        vkvideoCoinPerPointRatio: typeof data.vkvideoCoinPerPointRatio === 'number' ? data.vkvideoCoinPerPointRatio : 1,
        vkvideoRewardCoins: typeof data.vkvideoRewardCoins === 'number' ? data.vkvideoRewardCoins : null,
        vkvideoRewardOnlyWhenLive: getBoolean(data, 'vkvideoRewardOnlyWhenLive') ?? false,
      });

      applyBoostySnapshot(data);
      saveRefs.settingsLoadedRef.current = channelSlug;
    };

    try {
      const cached = getCachedChannelData(channelSlug);
      if (cached) {
        await applyFromSource(cached);
        return;
      }

      const channelData = await getChannelData(channelSlug);
      if (channelData) {
        await applyFromSource(channelData);
      }
    } catch {
      saveRefs.settingsLoadedRef.current = null;
    }
  }, [
    applyBoostySnapshot,
    applyTwitchAutoRewardsSnapshot,
    getCachedChannelData,
    getChannelData,
    loadTwitchAutoRewardsFromSettings,
    saveRefs,
    setRewardSettings,
    channelSlug,
  ]);

  useEffect(() => {
    if (user?.channelId && channelSlug) {
      void loadRewardSettings();
    } else {
      saveRefs.settingsLoadedRef.current = null;
    }
  }, [channelSlug, loadRewardSettings, saveRefs, user?.channelId]);
}
