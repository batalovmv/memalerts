import { memo, useState } from 'react';

import type { RewardsPlatformId } from '@/features/settings/tabs/rewards/types';

import { useChannelColors } from '@/contexts/ChannelColorsContext';
import { useEconomySettings } from '@/features/settings/tabs/rewards/model/useEconomySettings';
import { useRewardsSettingsLoader } from '@/features/settings/tabs/rewards/model/useRewardsSettingsLoader';
import { useRewardsSettingsSaveRefs } from '@/features/settings/tabs/rewards/model/useRewardsSettingsSaveRefs';
import { useRewardsSettingsState } from '@/features/settings/tabs/rewards/model/useRewardsSettingsState';
import { useSubmissionsRewards } from '@/features/settings/tabs/rewards/model/useSubmissionsRewards';
import { useTwitchRewards } from '@/features/settings/tabs/rewards/model/useTwitchRewards';
import { useVkvideoRewards } from '@/features/settings/tabs/rewards/model/useVkvideoRewards';
import { useWheelSettings } from '@/features/settings/tabs/rewards/model/useWheelSettings';
import { EconomySettingsSection } from '@/features/settings/tabs/rewards/ui/EconomySettingsSection';
import { RewardsPlatformTabs } from '@/features/settings/tabs/rewards/ui/RewardsPlatformTabs';
import { RewardsSettingsHeader } from '@/features/settings/tabs/rewards/ui/RewardsSettingsHeader';
import { SubmissionsRewardsSection } from '@/features/settings/tabs/rewards/ui/SubmissionsRewardsSection';
import { TwitchRewardsSection } from '@/features/settings/tabs/rewards/ui/TwitchRewardsSection';
import { VkvideoRewardsSection } from '@/features/settings/tabs/rewards/ui/VkvideoRewardsSection';
import { WheelSettingsSection } from '@/features/settings/tabs/rewards/ui/WheelSettingsSection';
import { useAppSelector } from '@/store/hooks';

export const RewardsSettings = memo(function RewardsSettings() {
  const { user } = useAppSelector((state) => state.auth);
  const { getChannelData, getCachedChannelData } = useChannelColors();
  // Treat undefined as "unknown" (do not block). Block only when backend explicitly says null.
  const twitchLinked = user?.channel?.twitchChannelId !== null;
  const externalAccounts = Array.isArray(user?.externalAccounts) ? user.externalAccounts : [];
  const linkedProviders = new Set(
    externalAccounts.map((a) => String((a as { provider?: unknown })?.provider || '').toLowerCase()).filter(Boolean),
  );
  const vkvideoLinked = linkedProviders.has('vkvideo');
  const [activePlatform, setActivePlatform] = useState<RewardsPlatformId>('twitch');
  const saveRefs = useRewardsSettingsSaveRefs();
  const { rewardSettings, setRewardSettings } = useRewardsSettingsState();

  const twitchRewards = useTwitchRewards({
    rewardSettings,
    setRewardSettings,
    channelId: user?.channelId,
    channelSlug: user?.channel?.slug,
    settingsLoadedRef: saveRefs.settingsLoadedRef,
    lastSavedTwitchRef: saveRefs.lastSavedTwitchRef,
  });

  const vkvideoRewards = useVkvideoRewards({
    rewardSettings,
    setRewardSettings,
    channelSlug: user?.channel?.slug,
    settingsLoadedRef: saveRefs.settingsLoadedRef,
    lastSavedVkvideoRef: saveRefs.lastSavedVkvideoRef,
  });

  const submissionsRewards = useSubmissionsRewards({
    rewardSettings,
    channelSlug: user?.channel?.slug,
    settingsLoadedRef: saveRefs.settingsLoadedRef,
    lastSavedApprovedRef: saveRefs.lastSavedApprovedRef,
  });

  const economySettings = useEconomySettings({
    rewardSettings,
    channelSlug: user?.channel?.slug,
    settingsLoadedRef: saveRefs.settingsLoadedRef,
    lastSavedEconomyRef: saveRefs.lastSavedEconomyRef,
  });

  const wheelSettings = useWheelSettings({
    rewardSettings,
    channelSlug: user?.channel?.slug,
    settingsLoadedRef: saveRefs.settingsLoadedRef,
    lastSavedWheelRef: saveRefs.lastSavedWheelRef,
  });


  useRewardsSettingsLoader({
    user,
    getChannelData,
    getCachedChannelData,
    setRewardSettings,
    saveRefs,
  });

  return (
    <div className="space-y-6">
      <RewardsSettingsHeader />

      <div className="space-y-6">
        {/* Platform switcher (reduces clutter by showing one platform at a time) */}
        <RewardsPlatformTabs
          activePlatform={activePlatform}
          onChange={setActivePlatform}
          twitchLinked={twitchLinked}
          vkvideoLinked={vkvideoLinked}
        />

        {activePlatform === 'twitch' ? (
          <TwitchRewardsSection
            rewardSettings={rewardSettings}
            onChangeRewardSettings={setRewardSettings}
            savingTwitchReward={twitchRewards.savingTwitchReward}
            twitchSavedPulse={twitchRewards.twitchSavedPulse}
            eligibilityLoading={twitchRewards.eligibilityLoading}
            twitchRewardEligible={twitchRewards.twitchRewardEligible}
            twitchLinked={twitchLinked}
            lastErrorRequestId={twitchRewards.lastErrorRequestId}
          />
        ) : null}

        {activePlatform === 'economy' ? (
          <EconomySettingsSection
            rewardSettings={rewardSettings}
            onChangeRewardSettings={setRewardSettings}
            savingEconomy={economySettings.savingEconomy}
            economySavedPulse={economySettings.economySavedPulse}
          />
        ) : null}

        {activePlatform === 'wheel' ? (
          <WheelSettingsSection
            rewardSettings={rewardSettings}
            onChangeRewardSettings={setRewardSettings}
            savingWheel={wheelSettings.savingWheel}
            wheelSavedPulse={wheelSettings.wheelSavedPulse}
          />
        ) : null}

        {activePlatform === 'vkvideo' ? (
          <VkvideoRewardsSection
            rewardSettings={rewardSettings}
            onChangeRewardSettings={setRewardSettings}
            savingVkvideoReward={vkvideoRewards.savingVkvideoReward}
            vkvideoSavedPulse={vkvideoRewards.vkvideoSavedPulse}
            vkvideoLastErrorRequestId={vkvideoRewards.vkvideoLastErrorRequestId}
            vkvideoLinked={vkvideoLinked}
          />
        ) : null}

        {activePlatform === 'submissions' ? (
          <SubmissionsRewardsSection
            rewardSettings={rewardSettings}
            onChangeRewardSettings={setRewardSettings}
            savingApprovedMemeReward={submissionsRewards.savingApprovedMemeReward}
            approvedSavedPulse={submissionsRewards.approvedSavedPulse}
            restoreUploadCoins={submissionsRewards.restoreUploadCoins}
            restorePoolCoins={submissionsRewards.restorePoolCoins}
          />
        ) : null}

      </div>
    </div>
  );
});
