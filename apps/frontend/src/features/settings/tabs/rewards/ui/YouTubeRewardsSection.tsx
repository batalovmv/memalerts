import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

import type { RewardSettingsState } from '@/features/settings/tabs/rewards/types';
import type { Dispatch, SetStateAction } from 'react';

import { SettingsSection } from '@/features/settings/ui/SettingsSection';
import { HelpTooltip, Input } from '@/shared/ui';
import { SavedOverlay, SavingOverlay } from '@/shared/ui/StatusOverlays';

type YouTubeRewardsSectionProps = {
  rewardSettings: RewardSettingsState;
  onChangeRewardSettings: Dispatch<SetStateAction<RewardSettingsState>>;
  savingYoutubeLikeReward: boolean;
  youtubeLikeSavedPulse: boolean;
  youtubeLinked: boolean;
};

export function YouTubeRewardsSection({
  rewardSettings,
  onChangeRewardSettings,
  savingYoutubeLikeReward,
  youtubeLikeSavedPulse,
  youtubeLinked,
}: YouTubeRewardsSectionProps) {
  const { t } = useTranslation();

  return (
    <SettingsSection
      title={t('admin.youtubeLikeRewardTitle', { defaultValue: 'Награда за лайк YouTube' })}
      description={t('admin.youtubeLikeRewardDescription', {
        defaultValue: 'Зритель ставит лайк на YouTube и получает монеты на сайте.',
      })}
      overlay={
        <>
          {savingYoutubeLikeReward && <SavingOverlay label={t('admin.saving', { defaultValue: 'Saving…' })} />}
          {youtubeLikeSavedPulse && !savingYoutubeLikeReward && <SavedOverlay label={t('admin.saved', { defaultValue: 'Saved' })} />}
        </>
      }
      right={
        <HelpTooltip content={t('help.settings.rewards.enableYoutubeLikeReward', { defaultValue: 'Enable/disable YouTube like → coins reward.' })}>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={rewardSettings.youtubeLikeRewardEnabled}
              disabled={savingYoutubeLikeReward}
              onChange={(e) => {
                const nextEnabled = e.target.checked;
                if (nextEnabled && !youtubeLinked) {
                  toast.error(
                    t('admin.youtubeNotLinked', {
                      defaultValue: 'YouTube account is not linked. Link YouTube in Settings → Accounts.',
                    }),
                  );
                  return;
                }
                if (nextEnabled) {
                  onChangeRewardSettings((p) => ({
                    ...p,
                    youtubeLikeRewardEnabled: true,
                    youtubeLikeRewardCoins: String(p.youtubeLikeRewardCoins || '').trim() ? p.youtubeLikeRewardCoins : '10',
                  }));
                  return;
                }
                onChangeRewardSettings((p) => ({ ...p, youtubeLikeRewardEnabled: false }));
              }}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/20 dark:peer-focus:ring-primary/30 rounded-full peer dark:bg-gray-600 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-primary"></div>
          </label>
        </HelpTooltip>
      }
      contentClassName={rewardSettings.youtubeLikeRewardEnabled ? 'space-y-4' : undefined}
    >
      {!youtubeLinked && (
        <p className="text-sm text-yellow-700 dark:text-yellow-300">
          {t('admin.youtubeNotLinked', { defaultValue: 'YouTube account is not linked. Link YouTube in Settings → Accounts.' })}
        </p>
      )}
      {rewardSettings.youtubeLikeRewardEnabled && (
        <div className={savingYoutubeLikeReward ? 'pointer-events-none opacity-60' : ''}>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="text-sm font-medium text-gray-700 dark:text-gray-300">
                {t('admin.rewardOnlyWhenLiveTitle', { defaultValue: 'Active only when stream is live' })}
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                {t('admin.youtubeLikeRewardOnlyWhenLiveHint', {
                  defaultValue: 'If enabled, reward can be claimed only while your stream is live.',
                })}
              </div>
            </div>
            <HelpTooltip
              content={t('help.settings.rewards.onlyWhenLiveYoutube', {
                defaultValue: 'If enabled, the reward can be claimed only when live.',
              })}
            >
              <label className="relative inline-flex items-center cursor-pointer shrink-0">
                <input
                  type="checkbox"
                  checked={rewardSettings.youtubeLikeRewardOnlyWhenLive}
                  disabled={savingYoutubeLikeReward}
                  onChange={(e) => onChangeRewardSettings((p) => ({ ...p, youtubeLikeRewardOnlyWhenLive: e.target.checked }))}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/20 dark:peer-focus:ring-primary/30 rounded-full peer dark:bg-gray-600 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-primary"></div>
              </label>
            </HelpTooltip>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {t('admin.youtubeLikeRewardCoins', { defaultValue: 'Coins' })}
            </label>
            <Input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={rewardSettings.youtubeLikeRewardCoins}
              onChange={(e) => {
                const next = e.target.value.replace(/[^\d]/g, '');
                onChangeRewardSettings((p) => ({ ...p, youtubeLikeRewardCoins: next }));
              }}
              onKeyDown={(e) => {
                if (e.key === 'e' || e.key === 'E' || e.key === '+' || e.key === '-' || e.key === '.') {
                  e.preventDefault();
                }
              }}
              placeholder="10"
            />
          </div>
        </div>
      )}
    </SettingsSection>
  );
}
