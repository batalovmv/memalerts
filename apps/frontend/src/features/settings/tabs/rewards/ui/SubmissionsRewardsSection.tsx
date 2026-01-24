import { useTranslation } from 'react-i18next';

import type { RewardSettingsState } from '@/features/settings/tabs/rewards/types';
import type { Dispatch, SetStateAction } from 'react';

import { SettingsSection } from '@/features/settings/ui/SettingsSection';
import { Button, HelpTooltip, Input } from '@/shared/ui';
import { SavedOverlay, SavingOverlay } from '@/shared/ui/StatusOverlays';

type SubmissionsRewardsSectionProps = {
  rewardSettings: RewardSettingsState;
  onChangeRewardSettings: Dispatch<SetStateAction<RewardSettingsState>>;
  savingApprovedMemeReward: boolean;
  approvedSavedPulse: boolean;
  restoreUploadCoins: number;
  restorePoolCoins: number;
};

export function SubmissionsRewardsSection({
  rewardSettings,
  onChangeRewardSettings,
  savingApprovedMemeReward,
  approvedSavedPulse,
  restoreUploadCoins,
  restorePoolCoins,
}: SubmissionsRewardsSectionProps) {
  const { t } = useTranslation();

  return (
    <SettingsSection
      title={t('admin.approvedMemeRewardTitle', { defaultValue: 'Награда за одобренный мем (монеты)' })}
      description={t('admin.approvedMemeRewardDescription', { defaultValue: 'Начисляется автору заявки после одобрения.' })}
      overlay={
        <>
          {savingApprovedMemeReward && <SavingOverlay label={t('admin.saving', { defaultValue: 'Saving…' })} />}
          {approvedSavedPulse && !savingApprovedMemeReward && <SavedOverlay label={t('admin.saved', { defaultValue: 'Saved' })} />}
        </>
      }
      right={
        <HelpTooltip content={t('help.settings.rewards.enableApprovedReward', { defaultValue: 'Give coins to the viewer when you approve their meme. Turn off = set both rewards to 0.' })}>
          <label className={`relative inline-flex items-center cursor-pointer shrink-0 ${savingApprovedMemeReward ? 'opacity-60 cursor-not-allowed' : ''}`}>
            <input
              type="checkbox"
              checked={
                (parseInt(rewardSettings.submissionRewardCoinsUpload || '0', 10) || 0) > 0 ||
                (parseInt(rewardSettings.submissionRewardCoinsPool || '0', 10) || 0) > 0
              }
              disabled={savingApprovedMemeReward}
              onChange={(e) => {
                if (savingApprovedMemeReward) return;
                const enabled = e.target.checked;
                if (!enabled) {
                  onChangeRewardSettings({ ...rewardSettings, submissionRewardCoinsUpload: '0', submissionRewardCoinsPool: '0' });
                  return;
                }
                const restoreUpload = restoreUploadCoins > 0 ? restoreUploadCoins : 100;
                const restorePool = restorePoolCoins > 0 ? restorePoolCoins : 100;
                onChangeRewardSettings({
                  ...rewardSettings,
                  submissionRewardCoinsUpload: String(restoreUpload),
                  submissionRewardCoinsPool: String(restorePool),
                });
              }}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/20 dark:peer-focus:ring-primary/30 rounded-full peer dark:bg-gray-600 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-primary"></div>
          </label>
        </HelpTooltip>
      }
    >
      <div className={savingApprovedMemeReward ? 'pointer-events-none opacity-60' : ''}>
        <div className="flex items-start justify-between gap-4 mb-3">
          <div className="min-w-0">
            <div className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('admin.rewardOnlyWhenLiveTitle', { defaultValue: 'Active only when stream is live' })}
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              {t('admin.rewardOnlyWhenLiveHint', {
                defaultValue: 'When enabled, the reward works only while your Twitch stream is online.',
              })}
            </div>
          </div>
          <HelpTooltip content={t('help.settings.rewards.approvedOnlyWhenLive', { defaultValue: 'If enabled, coins are granted only when your stream is live.' })}>
            <label className={`relative inline-flex items-center cursor-pointer shrink-0 ${savingApprovedMemeReward ? 'opacity-60 cursor-not-allowed' : ''}`}>
              <input
                type="checkbox"
                checked={rewardSettings.submissionRewardOnlyWhenLive}
                disabled={savingApprovedMemeReward}
                onChange={(e) => onChangeRewardSettings((p) => ({ ...p, submissionRewardOnlyWhenLive: e.target.checked }))}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/20 dark:peer-focus:ring-primary/30 rounded-full peer dark:bg-gray-600 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-primary"></div>
            </label>
          </HelpTooltip>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <HelpTooltip content={t('help.settings.rewards.approvedUploadCoins', { defaultValue: 'How many coins the viewer gets when you approve a submission from upload/URL. Use 0 to disable.' })}>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t('admin.submissionRewardCoinsUpload', { defaultValue: 'Reward (upload / URL) (coins)' })}
              </label>
              <div className="flex items-center gap-2">
                <Input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={rewardSettings.submissionRewardCoinsUpload}
                  onChange={(e) => {
                    const next = e.target.value.replace(/[^\d]/g, '');
                    onChangeRewardSettings({ ...rewardSettings, submissionRewardCoinsUpload: next });
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'e' || e.key === 'E' || e.key === '+' || e.key === '-' || e.key === '.') {
                      e.preventDefault();
                    }
                  }}
                  placeholder="0"
                />
                <HelpTooltip content={t('help.settings.rewards.quickAdd100', { defaultValue: 'Quickly add +100 coins.' })}>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="shrink-0 glass-btn bg-white/40 dark:bg-white/5"
                    onClick={() => {
                      const current = rewardSettings.submissionRewardCoinsUpload
                        ? parseInt(rewardSettings.submissionRewardCoinsUpload, 10)
                        : 0;
                      const next = (Number.isFinite(current) ? current : 0) + 100;
                      onChangeRewardSettings({ ...rewardSettings, submissionRewardCoinsUpload: String(next) });
                    }}
                    disabled={savingApprovedMemeReward}
                  >
                    {t('admin.quickAdd100', { defaultValue: '+100' })}
                  </Button>
                </HelpTooltip>
              </div>
            </div>
          </HelpTooltip>

          <HelpTooltip content={t('help.settings.rewards.approvedPoolCoins', { defaultValue: 'How many coins the viewer gets when you approve a submission from the Pool. Use 0 to disable.' })}>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t('admin.submissionRewardCoinsPool', { defaultValue: 'Reward (pool) (coins)' })}
              </label>
              <div className="flex items-center gap-2">
                <Input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={rewardSettings.submissionRewardCoinsPool}
                  onChange={(e) => {
                    const next = e.target.value.replace(/[^\d]/g, '');
                    onChangeRewardSettings({ ...rewardSettings, submissionRewardCoinsPool: next });
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'e' || e.key === 'E' || e.key === '+' || e.key === '-' || e.key === '.') {
                      e.preventDefault();
                    }
                  }}
                  placeholder="0"
                />
                <HelpTooltip content={t('help.settings.rewards.quickAdd100', { defaultValue: 'Quickly add +100 coins.' })}>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="shrink-0 glass-btn bg-white/40 dark:bg-white/5"
                    onClick={() => {
                      const current = rewardSettings.submissionRewardCoinsPool
                        ? parseInt(rewardSettings.submissionRewardCoinsPool, 10)
                        : 0;
                      const next = (Number.isFinite(current) ? current : 0) + 100;
                      onChangeRewardSettings({ ...rewardSettings, submissionRewardCoinsPool: String(next) });
                    }}
                    disabled={savingApprovedMemeReward}
                  >
                    {t('admin.quickAdd100', { defaultValue: '+100' })}
                  </Button>
                </HelpTooltip>
              </div>
            </div>
          </HelpTooltip>
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          {t('admin.submissionRewardCoinsDescriptionSplit', {
            defaultValue:
              'Coins granted to the viewer when you approve their submission. Pool and upload/URL can have different rewards. Set 0 to disable.',
          })}
        </p>
      </div>
    </SettingsSection>
  );
}
