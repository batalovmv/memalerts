import { memo, useCallback, useState } from 'react';

import type { RewardsPlatformId } from '@/features/settings/tabs/rewards/types';

import { useChannelColors } from '@/contexts/ChannelColorsContext';
import { useBoostyAccess } from '@/features/settings/tabs/rewards/model/useBoostyAccess';
import { useBoostyRewards } from '@/features/settings/tabs/rewards/model/useBoostyRewards';
import { useKickRewards } from '@/features/settings/tabs/rewards/model/useKickRewards';
import { useRewardsSettingsLoader } from '@/features/settings/tabs/rewards/model/useRewardsSettingsLoader';
import { useRewardsSettingsSaveRefs } from '@/features/settings/tabs/rewards/model/useRewardsSettingsSaveRefs';
import { useRewardsSettingsState } from '@/features/settings/tabs/rewards/model/useRewardsSettingsState';
import { useSubmissionsRewards } from '@/features/settings/tabs/rewards/model/useSubmissionsRewards';
import { useTrovoRewards } from '@/features/settings/tabs/rewards/model/useTrovoRewards';
import { useTwitchAutoRewards } from '@/features/settings/tabs/rewards/model/useTwitchAutoRewards';
import { useTwitchRewards } from '@/features/settings/tabs/rewards/model/useTwitchRewards';
import { useVkvideoRewards } from '@/features/settings/tabs/rewards/model/useVkvideoRewards';
import { useYoutubeLikeRewards } from '@/features/settings/tabs/rewards/model/useYoutubeLikeRewards';
import { AutoRewardsSection } from '@/features/settings/tabs/rewards/ui/AutoRewardsSection';
import { BoostyAccessSection } from '@/features/settings/tabs/rewards/ui/BoostyAccessSection';
import { BoostyRewardsSection } from '@/features/settings/tabs/rewards/ui/BoostyRewardsSection';
import { KickRewardsSection } from '@/features/settings/tabs/rewards/ui/KickRewardsSection';
import { RewardsPlatformTabs } from '@/features/settings/tabs/rewards/ui/RewardsPlatformTabs';
import { RewardsSettingsHeader } from '@/features/settings/tabs/rewards/ui/RewardsSettingsHeader';
import { SubmissionsRewardsSection } from '@/features/settings/tabs/rewards/ui/SubmissionsRewardsSection';
import { TrovoRewardsSection } from '@/features/settings/tabs/rewards/ui/TrovoRewardsSection';
import { TwitchRewardsSection } from '@/features/settings/tabs/rewards/ui/TwitchRewardsSection';
import { VkvideoRewardsSection } from '@/features/settings/tabs/rewards/ui/VkvideoRewardsSection';
import { YouTubeRewardsSection } from '@/features/settings/tabs/rewards/ui/YouTubeRewardsSection';
import { login } from '@/shared/auth/login';
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
  const youtubeLinked = linkedProviders.has('youtube');
  const kickLinked = linkedProviders.has('kick');
  const trovoLinked = linkedProviders.has('trovo');
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

  const twitchAutoRewards = useTwitchAutoRewards({
    lastSavedTwitchAutoRewardsRef: saveRefs.lastSavedTwitchAutoRewardsRef,
    onClearRequestId: twitchRewards.clearLastErrorRequestId,
  });

  const youtubeLikeRewards = useYoutubeLikeRewards({
    rewardSettings,
    channelSlug: user?.channel?.slug,
    settingsLoadedRef: saveRefs.settingsLoadedRef,
    lastSavedYoutubeLikeRef: saveRefs.lastSavedYoutubeLikeRef,
  });

  const kickRewards = useKickRewards({
    rewardSettings,
    setRewardSettings,
    channelSlug: user?.channel?.slug,
    settingsLoadedRef: saveRefs.settingsLoadedRef,
    lastSavedKickRef: saveRefs.lastSavedKickRef,
  });

  const trovoRewards = useTrovoRewards({
    rewardSettings,
    channelSlug: user?.channel?.slug,
    trovoLinked,
    settingsLoadedRef: saveRefs.settingsLoadedRef,
    lastSavedTrovoRef: saveRefs.lastSavedTrovoRef,
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

  const boostyRewards = useBoostyRewards({
    channelSlug: user?.channel?.slug,
    settingsLoadedRef: saveRefs.settingsLoadedRef,
    lastSavedBoostyRef: saveRefs.lastSavedBoostyRef,
  });

  const effectiveChannelId = user?.channelId || user?.channel?.id || null;

  const boostyAccess = useBoostyAccess({ effectiveChannelId });

  useRewardsSettingsLoader({
    user,
    getChannelData,
    getCachedChannelData,
    setRewardSettings,
    applyBoostySnapshot: boostyRewards.applyBoostySnapshot,
    applyTwitchAutoRewardsSnapshot: twitchAutoRewards.applySnapshot,
    loadTwitchAutoRewardsFromSettings: twitchAutoRewards.loadFromSettings,
    saveRefs,
  });

  const startLogin = useCallback(() => {
    login('/settings?tab=rewards');
  }, []);

  const autoRewardsLinked = twitchLinked || kickLinked || trovoLinked || vkvideoLinked;

  return (
    <div className="space-y-6">
      <RewardsSettingsHeader />

      <div className="space-y-6">
        {/* Platform switcher (reduces clutter by showing one platform at a time) */}
        <RewardsPlatformTabs
          activePlatform={activePlatform}
          onChange={setActivePlatform}
          autoRewardsLinked={autoRewardsLinked}
          twitchLinked={twitchLinked}
          youtubeLinked={youtubeLinked}
          kickLinked={kickLinked}
          vkvideoLinked={vkvideoLinked}
          trovoLinked={trovoLinked}
        />

        {activePlatform === 'common' ? (
          <AutoRewardsSection
            saving={twitchAutoRewards.savingTwitchAutoRewards}
            savedPulse={twitchAutoRewards.twitchAutoRewardsSavedPulse}
            autoRewardsLinked={autoRewardsLinked}
            error={twitchAutoRewards.twitchAutoRewardsError}
            draft={twitchAutoRewards.twitchAutoRewardsDraft}
            onChangeDraft={(next) => {
              twitchAutoRewards.setTwitchAutoRewardsDraft(next);
              twitchAutoRewards.clearTwitchAutoRewardsError();
            }}
            onSave={(overrideValue) => void twitchAutoRewards.saveTwitchAutoRewards(overrideValue)}
            onClear={() => {
              twitchAutoRewards.setTwitchAutoRewardsDraft(null);
              twitchAutoRewards.clearTwitchAutoRewardsError();
              void twitchAutoRewards.saveTwitchAutoRewards(null);
            }}
          />
        ) : null}

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
            savingTwitchAutoRewards={twitchAutoRewards.savingTwitchAutoRewards}
            twitchAutoRewardsSavedPulse={twitchAutoRewards.twitchAutoRewardsSavedPulse}
            twitchAutoRewardsError={twitchAutoRewards.twitchAutoRewardsError}
            twitchAutoRewardsDraft={twitchAutoRewards.twitchAutoRewardsDraft}
            onChangeTwitchAutoRewardsDraft={(next) => {
              twitchAutoRewards.setTwitchAutoRewardsDraft(next);
              twitchAutoRewards.clearTwitchAutoRewardsError();
            }}
            onSaveTwitchAutoRewards={(overrideValue) => void twitchAutoRewards.saveTwitchAutoRewards(overrideValue)}
            onClearTwitchAutoRewards={() => {
              twitchAutoRewards.setTwitchAutoRewardsDraft(null);
              twitchAutoRewards.clearTwitchAutoRewardsError();
              void twitchAutoRewards.saveTwitchAutoRewards(null);
            }}
          />
        ) : null}

        {activePlatform === 'youtube' ? (
          <YouTubeRewardsSection
            rewardSettings={rewardSettings}
            onChangeRewardSettings={setRewardSettings}
            savingYoutubeLikeReward={youtubeLikeRewards.savingYoutubeLikeReward}
            youtubeLikeSavedPulse={youtubeLikeRewards.youtubeLikeSavedPulse}
            youtubeLinked={youtubeLinked}
          />
        ) : null}

        {activePlatform === 'kick' ? (
          <KickRewardsSection
            rewardSettings={rewardSettings}
            onChangeRewardSettings={setRewardSettings}
            savingKickReward={kickRewards.savingKickReward}
            kickSavedPulse={kickRewards.kickSavedPulse}
            kickBackendUnsupported={kickRewards.kickBackendUnsupported}
            kickLinked={kickLinked}
            kickLastErrorRequestId={kickRewards.kickLastErrorRequestId}
          />
        ) : null}

        {activePlatform === 'trovo' ? (
          <TrovoRewardsSection
            rewardSettings={rewardSettings}
            onChangeRewardSettings={setRewardSettings}
            savingTrovoReward={trovoRewards.savingTrovoReward}
            trovoSavedPulse={trovoRewards.trovoSavedPulse}
            trovoLinked={trovoLinked}
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

        {activePlatform === 'boosty' ? (
          <>
            <BoostyAccessSection
              effectiveChannelId={effectiveChannelId}
              boostyAccess={boostyAccess.boostyAccess}
              boostyAccessLoading={boostyAccess.boostyAccessLoading}
              boostyAccessError={boostyAccess.boostyAccessError}
              boostyAccessNeedsAuth={boostyAccess.boostyAccessNeedsAuth}
              onRefresh={() => void boostyAccess.refreshBoostyAccess()}
              onStartLogin={startLogin}
              onLinkDiscord={boostyAccess.redirectToDiscordLink}
            />
            <BoostyRewardsSection
              boostySettings={boostyRewards.boostySettings}
              boostyTierErrors={boostyRewards.boostyTierErrors}
              savingBoosty={boostyRewards.savingBoosty}
              boostySavedPulse={boostyRewards.boostySavedPulse}
              onChangeBoostySettings={boostyRewards.setBoostySettings}
              onChangeBoostyTierErrors={boostyRewards.setBoostyTierErrors}
            />
          </>
        ) : null}
      </div>
    </div>
  );
});
