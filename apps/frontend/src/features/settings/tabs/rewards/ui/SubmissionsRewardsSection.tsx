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
      title={t('admin.approvedMemeRewardTitle', { defaultValue: 'Бонус за одобренный мем (монеты)' })}
      description={t('admin.approvedMemeRewardDescription', { defaultValue: 'Базово +20 монет всегда, сверху добавляется бонус (0-100).' })}
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
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <HelpTooltip content={t('help.settings.rewards.approvedUploadCoins', { defaultValue: 'Bonus (0-100) added on top of the base +20 when you approve an upload/URL.' })}>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t('admin.submissionRewardCoinsUpload', { defaultValue: 'Bonus (upload / URL) (coins)' })}
              </label>
              <div className="flex items-center gap-2">
                <Input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={rewardSettings.submissionRewardCoinsUpload}
                  onChange={(e) => {
                    const next = e.target.value.replace(/[^\d]/g, '');
                    const clamped = Math.min(100, parseInt(next || '0', 10));
                    onChangeRewardSettings({ ...rewardSettings, submissionRewardCoinsUpload: String(clamped) });
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
                      const next = Math.min(100, (Number.isFinite(current) ? current : 0) + 100);
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

          <HelpTooltip content={t('help.settings.rewards.approvedPoolCoins', { defaultValue: 'Bonus (0-100) added on top of the base +20 when you approve a Pool submission.' })}>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t('admin.submissionRewardCoinsPool', { defaultValue: 'Bonus (pool) (coins)' })}
              </label>
              <div className="flex items-center gap-2">
                <Input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={rewardSettings.submissionRewardCoinsPool}
                  onChange={(e) => {
                    const next = e.target.value.replace(/[^\d]/g, '');
                    const clamped = Math.min(100, parseInt(next || '0', 10));
                    onChangeRewardSettings({ ...rewardSettings, submissionRewardCoinsPool: String(clamped) });
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
                      const next = Math.min(100, (Number.isFinite(current) ? current : 0) + 100);
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
              'Base reward is +20 coins for every approved submission. Bonus (0-100) can differ for pool vs upload/URL.',
          })}
        </p>
      </div>
    </SettingsSection>
  );
}
