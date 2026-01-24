import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

import type { RewardSettingsState } from '@/features/settings/tabs/rewards/types';
import type { TwitchAutoRewardsV1 } from '@/types';
import type { Dispatch, SetStateAction } from 'react';

import { AutoRewardsEditor } from '@/features/settings/tabs/rewards/TwitchAutoRewardsEditor';
import { SettingsSection } from '@/features/settings/ui/SettingsSection';
import { Button, HelpTooltip, Input } from '@/shared/ui';
import SecretCopyField from '@/shared/ui/SecretCopyField/SecretCopyField';
import { SavedOverlay, SavingOverlay } from '@/shared/ui/StatusOverlays';

type TwitchRewardsSectionProps = {
  rewardSettings: RewardSettingsState;
  onChangeRewardSettings: Dispatch<SetStateAction<RewardSettingsState>>;
  savingTwitchReward: boolean;
  twitchSavedPulse: boolean;
  eligibilityLoading: boolean;
  twitchRewardEligible: boolean | null;
  twitchLinked: boolean;
  lastErrorRequestId: string | null;
  savingTwitchAutoRewards: boolean;
  twitchAutoRewardsSavedPulse: boolean;
  twitchAutoRewardsError: string | null;
  twitchAutoRewardsDraft: TwitchAutoRewardsV1 | null;
  onChangeTwitchAutoRewardsDraft: (next: TwitchAutoRewardsV1 | null) => void;
  onSaveTwitchAutoRewards: (overrideValue?: TwitchAutoRewardsV1 | null) => void;
  onClearTwitchAutoRewards: () => void;
};

export function TwitchRewardsSection({
  rewardSettings,
  onChangeRewardSettings,
  savingTwitchReward,
  twitchSavedPulse,
  eligibilityLoading,
  twitchRewardEligible,
  twitchLinked,
  lastErrorRequestId,
  savingTwitchAutoRewards,
  twitchAutoRewardsSavedPulse,
  twitchAutoRewardsError,
  twitchAutoRewardsDraft,
  onChangeTwitchAutoRewardsDraft,
  onSaveTwitchAutoRewards,
  onClearTwitchAutoRewards,
}: TwitchRewardsSectionProps) {
  const { t } = useTranslation();

  return (
    <>
      <SettingsSection
        title={t('admin.twitchCoinsRewardTitle', { defaultValue: 'Награда за монеты (Twitch)' })}
        description={t('admin.twitchCoinsRewardDescription', {
          defaultValue: 'Зритель тратит Channel Points на Twitch и получает монеты на сайте.',
        })}
        overlay={
          <>
            {savingTwitchReward && <SavingOverlay label={t('admin.saving', { defaultValue: 'Saving…' })} />}
            {twitchSavedPulse && !savingTwitchReward && <SavedOverlay label={t('admin.saved', { defaultValue: 'Saved' })} />}
          </>
        }
        right={
          <HelpTooltip
            content={t('help.settings.rewards.enableTwitchReward', {
              defaultValue: 'Turn the Twitch reward on/off (it gives coins to viewers).',
            })}
          >
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={rewardSettings.rewardEnabled}
                disabled={savingTwitchReward || eligibilityLoading || twitchRewardEligible === false || !twitchLinked}
                onChange={(e) => {
                  if (!twitchLinked) {
                    toast.error(t('admin.twitchChannelNotLinked', { defaultValue: 'This channel is not linked to Twitch.' }));
                    return;
                  }
                  if (twitchRewardEligible === false) {
                    toast.error(
                      t('admin.twitchRewardNotAvailable', {
                        defaultValue: 'This Twitch reward is available only for affiliate/partner channels.',
                      }),
                    );
                    return;
                  }
                  const nextEnabled = e.target.checked;
                  if (nextEnabled) {
                    onChangeRewardSettings((p) => ({
                      ...p,
                      rewardEnabled: true,
                      rewardTitle: p.rewardTitle?.trim()
                        ? p.rewardTitle
                        : t('admin.rewardTitlePlaceholder', { defaultValue: 'Get Coins' }),
                      rewardCost: String(p.rewardCost || '').trim() ? p.rewardCost : '1000',
                      rewardCoins: String(p.rewardCoins || '').trim() ? p.rewardCoins : '1000',
                    }));
                    return;
                  }
                  onChangeRewardSettings((p) => ({ ...p, rewardEnabled: false }));
                }}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/20 dark:peer-focus:ring-primary/30 rounded-full peer dark:bg-gray-600 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-primary"></div>
            </label>
          </HelpTooltip>
        }
        contentClassName={rewardSettings.rewardEnabled ? 'space-y-4' : undefined}
      >
        {twitchRewardEligible === null && (
          <p className="text-sm text-yellow-700 dark:text-yellow-300">
            {t('admin.twitchEligibilityUnknown', {
              defaultValue:
                "We couldn't verify Twitch eligibility right now. You can try enabling the reward; if it fails, log out and log in again.",
            })}
          </p>
        )}
        {lastErrorRequestId && (
          <p className="text-xs text-gray-600 dark:text-gray-400 select-text">
            {t('common.errorId', { defaultValue: 'Error ID' })}: <span className="font-mono">{lastErrorRequestId}</span>
          </p>
        )}
        {twitchRewardEligible === false && (
          <p className="text-sm text-yellow-700 dark:text-yellow-300">
            {t('admin.twitchRewardNotAvailable', {
              defaultValue: 'This Twitch reward is available only for affiliate/partner channels.',
            })}
          </p>
        )}
        {!twitchLinked && (
          <p className="text-sm text-yellow-700 dark:text-yellow-300">
            {t('admin.twitchChannelNotLinked', { defaultValue: 'This channel is not linked to Twitch.' })}
          </p>
        )}

        {rewardSettings.rewardEnabled && (
          <div className={savingTwitchReward ? 'pointer-events-none opacity-60' : ''}>
            <div className="flex items-start justify-between gap-4">
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
              <HelpTooltip
                content={t('help.settings.rewards.onlyWhenLive', {
                  defaultValue: 'If enabled, the reward works only when your stream is live.',
                })}
              >
                <label className="relative inline-flex items-center cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    checked={rewardSettings.rewardOnlyWhenLive}
                    disabled={savingTwitchReward}
                    onChange={(e) => onChangeRewardSettings((p) => ({ ...p, rewardOnlyWhenLive: e.target.checked }))}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/20 dark:peer-focus:ring-primary/30 rounded-full peer dark:bg-gray-600 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-primary"></div>
                </label>
              </HelpTooltip>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t('admin.rewardTitle')}
              </label>
              <Input
                type="text"
                value={rewardSettings.rewardTitle}
                onChange={(e) => onChangeRewardSettings((p) => ({ ...p, rewardTitle: e.target.value }))}
                placeholder={t('admin.rewardTitlePlaceholder')}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="flex flex-col">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {t('admin.rewardCost')}
                </label>
                <Input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={rewardSettings.rewardCost}
                  onChange={(e) => {
                    const next = e.target.value.replace(/[^\d]/g, '');
                    onChangeRewardSettings((p) => ({ ...p, rewardCost: next }));
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'e' || e.key === 'E' || e.key === '+' || e.key === '-' || e.key === '.') {
                      e.preventDefault();
                    }
                  }}
                  placeholder="100"
                  required={rewardSettings.rewardEnabled}
                />
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 min-h-[2.25rem]">
                  {t('admin.rewardCostDescription')}
                </p>
              </div>
              <div className="flex flex-col">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {t('admin.rewardCoins')}
                </label>
                <Input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={rewardSettings.rewardCoins}
                  onChange={(e) => {
                    const next = e.target.value.replace(/[^\d]/g, '');
                    onChangeRewardSettings((p) => ({ ...p, rewardCoins: next }));
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'e' || e.key === 'E' || e.key === '+' || e.key === '-' || e.key === '.') {
                      e.preventDefault();
                    }
                  }}
                  placeholder="100"
                  required={rewardSettings.rewardEnabled}
                />
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 min-h-[2.25rem]">
                  {t('admin.rewardCoinsDescription')}
                </p>
              </div>
            </div>
            <div>
              <SecretCopyField
                label={`${t('admin.rewardIdForCoins', { defaultValue: 'Reward ID' })} (${t('admin.autoGenerated', { defaultValue: 'auto-generated' })})`}
                value={rewardSettings.rewardIdForCoins}
                masked={true}
                description={t('admin.rewardIdDescription', { defaultValue: 'Click to copy. Use the eye icon to reveal.' })}
                emptyText={t('common.notSet', { defaultValue: 'Not set' })}
              />
            </div>
          </div>
        )}
      </SettingsSection>

      <SettingsSection
        title={t('admin.twitchChannelPointsMappingTitle', { defaultValue: 'Twitch Channel Points: rewardId → coins' })}
        description={t('admin.twitchChannelPointsMappingDescription', {
          defaultValue: 'Twitch-only mapping. Stored inside the auto-rewards JSON.',
        })}
        overlay={
          <>
            {savingTwitchAutoRewards && <SavingOverlay label={t('admin.saving', { defaultValue: 'Saving…' })} />}
            {twitchAutoRewardsSavedPulse && !savingTwitchAutoRewards && <SavedOverlay label={t('admin.saved', { defaultValue: 'Saved' })} />}
          </>
        }
        right={
          <div className="flex items-center gap-2">
            <Button variant="primary" size="sm" disabled={savingTwitchAutoRewards || !twitchLinked} onClick={() => onSaveTwitchAutoRewards()}>
              {t('common.save', { defaultValue: 'Save' })}
            </Button>
            <Button variant="secondary" size="sm" disabled={savingTwitchAutoRewards || !twitchLinked} onClick={onClearTwitchAutoRewards}>
              {t('common.clear', { defaultValue: 'Clear' })}
            </Button>
          </div>
        }
      >
        {!twitchLinked && (
          <p className="text-sm text-yellow-700 dark:text-yellow-300">
            {t('admin.twitchChannelNotLinked', { defaultValue: 'This channel is not linked to Twitch.' })}
          </p>
        )}
        {twitchAutoRewardsError && <p className="text-sm text-rose-600 dark:text-rose-300">{twitchAutoRewardsError}</p>}
        <AutoRewardsEditor
          value={twitchAutoRewardsDraft}
          onChange={onChangeTwitchAutoRewardsDraft}
          disabled={savingTwitchAutoRewards || !twitchLinked}
          variant="channelPointsOnly"
        />
      </SettingsSection>
    </>
  );
}
