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
  saveRefs: RewardsSettingsSaveRefs;
};

export function useRewardsSettingsLoader({
  user,
  getChannelData,
  getCachedChannelData,
  setRewardSettings,
  saveRefs,
}: UseRewardsSettingsLoaderParams) {
  const channelSlug = user?.channel?.slug ?? null;
  const loadRewardSettings = useCallback(async () => {
    if (!channelSlug) return;

    if (saveRefs.settingsLoadedRef.current === channelSlug) {
      return;
    }

    const applyFromSource = async (source: unknown) => {
      const sourceRec = toRecord(source);

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

      const economyRec = toRecord(data.economy);
      const economySettings = toRecord(economyRec?.settings);
      const economyMemesPerHour =
        asNumber(economySettings?.memesPerHour) ?? asNumber(data.economyMemesPerHour) ?? 2;
      const economyAvgMemePriceCoins =
        asNumber(economySettings?.avgMemePriceCoins) ?? asNumber(data.defaultPriceCoins) ?? 100;
      const economyRewardMultiplier =
        asNumber(economySettings?.rewardMultiplier) ?? asNumber(data.economyRewardMultiplier) ?? 1;
      const wheelEnabled = getBoolean(data, 'wheelEnabled') ?? true;
      const wheelPaidSpinCostCoins = asNumber(data.wheelPaidSpinCostCoins);
      const wheelPrizeMultiplier = asNumber(data.wheelPrizeMultiplier) ?? 1;

      setRewardSettings({
        rewardIdForCoins: asString(data.rewardIdForCoins),
        rewardEnabled: asBoolean(data.rewardEnabled),
        rewardTitle: asString(data.rewardTitle),
        rewardCost: asNumberStringOrEmpty(data.rewardCost),
        rewardCoins: asNumberStringOrEmpty(data.rewardCoins),
        rewardOnlyWhenLive: getBoolean(data, 'rewardOnlyWhenLive') ?? false,
        vkvideoRewardEnabled: getBoolean(data, 'vkvideoRewardEnabled') ?? false,
        vkvideoRewardIdForCoins: typeof data.vkvideoRewardIdForCoins === 'string' ? String(data.vkvideoRewardIdForCoins) : '',
        vkvideoCoinPerPointRatio:
          typeof data.vkvideoCoinPerPointRatio === 'number' ? String(data.vkvideoCoinPerPointRatio) : '1',
        vkvideoRewardCoins: typeof data.vkvideoRewardCoins === 'number' ? String(data.vkvideoRewardCoins) : '',
        vkvideoRewardOnlyWhenLive: getBoolean(data, 'vkvideoRewardOnlyWhenLive') ?? false,
        submissionRewardCoinsUpload: String(uploadCoins ?? 0),
        submissionRewardCoinsPool: String(poolCoins ?? 0),
        submissionRewardOnlyWhenLive: getBoolean(data, 'submissionRewardOnlyWhenLive') ?? false,
        economyMemesPerHour: String(economyMemesPerHour),
        economyAvgMemePriceCoins: String(economyAvgMemePriceCoins),
        economyRewardMultiplier: String(economyRewardMultiplier),
        wheelEnabled,
        wheelPaidSpinCostCoins: typeof wheelPaidSpinCostCoins === 'number' ? String(wheelPaidSpinCostCoins) : '',
        wheelPrizeMultiplier: String(wheelPrizeMultiplier),
      });

      saveRefs.lastSavedTwitchRef.current = JSON.stringify({
        rewardIdForCoins: asNonEmptyStringOrNull(data.rewardIdForCoins),
        rewardEnabled: asBoolean(data.rewardEnabled),
        rewardTitle: asNonEmptyStringOrNull(data.rewardTitle),
        rewardCost: asNumber(data.rewardCost),
        rewardCoins: asNumber(data.rewardCoins),
        rewardOnlyWhenLive: getBoolean(data, 'rewardOnlyWhenLive') ?? false,
      });
      saveRefs.lastSavedApprovedRef.current = JSON.stringify({
        submissionRewardCoinsUpload: uploadCoins ?? 0,
        submissionRewardCoinsPool: poolCoins ?? 0,
        submissionRewardOnlyWhenLive: getBoolean(data, 'submissionRewardOnlyWhenLive') ?? false,
      });
      saveRefs.lastSavedVkvideoRef.current = JSON.stringify({
        vkvideoRewardEnabled: getBoolean(data, 'vkvideoRewardEnabled') ?? false,
        vkvideoRewardIdForCoins:
          typeof data.vkvideoRewardIdForCoins === 'string' ? String(data.vkvideoRewardIdForCoins) : null,
        vkvideoCoinPerPointRatio: typeof data.vkvideoCoinPerPointRatio === 'number' ? data.vkvideoCoinPerPointRatio : 1,
        vkvideoRewardCoins: typeof data.vkvideoRewardCoins === 'number' ? data.vkvideoRewardCoins : null,
        vkvideoRewardOnlyWhenLive: getBoolean(data, 'vkvideoRewardOnlyWhenLive') ?? false,
      });
      saveRefs.lastSavedEconomyRef.current = JSON.stringify({
        economyMemesPerHour,
        economyAvgMemePriceCoins,
        economyRewardMultiplier,
      });
      saveRefs.lastSavedWheelRef.current = JSON.stringify({
        wheelEnabled,
        wheelPaidSpinCostCoins: typeof wheelPaidSpinCostCoins === 'number' ? wheelPaidSpinCostCoins : null,
        wheelPrizeMultiplier,
      });

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
  }, [getCachedChannelData, getChannelData, saveRefs, setRewardSettings, channelSlug]);

  useEffect(() => {
    if (user?.channelId && channelSlug) {
      void loadRewardSettings();
    } else {
      saveRefs.settingsLoadedRef.current = null;
    }
  }, [channelSlug, loadRewardSettings, saveRefs, user?.channelId]);
}
