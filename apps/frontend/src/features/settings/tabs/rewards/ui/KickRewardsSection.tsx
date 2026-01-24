import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

import type { RewardSettingsState } from '@/features/settings/tabs/rewards/types';
import type { Dispatch, SetStateAction } from 'react';

import { SettingsSection } from '@/features/settings/ui/SettingsSection';
import { HelpTooltip, Input } from '@/shared/ui';
import { SavedOverlay, SavingOverlay } from '@/shared/ui/StatusOverlays';

type KickRewardsSectionProps = {
  rewardSettings: RewardSettingsState;
  onChangeRewardSettings: Dispatch<SetStateAction<RewardSettingsState>>;
  savingKickReward: boolean;
  kickSavedPulse: boolean;
  kickBackendUnsupported: boolean;
  kickLinked: boolean;
  kickLastErrorRequestId: string | null;
};

export function KickRewardsSection({
  rewardSettings,
  onChangeRewardSettings,
  savingKickReward,
  kickSavedPulse,
  kickBackendUnsupported,
  kickLinked,
  kickLastErrorRequestId,
}: KickRewardsSectionProps) {
  const { t } = useTranslation();

  return (
    <SettingsSection
      title={t('admin.kickCoinsRewardTitle', { defaultValue: 'Награда за монеты (Kick)' })}
      description={t('admin.kickCoinsRewardDescription', {
        defaultValue: 'Зритель активирует награду на Kick и получает монеты на сайте.',
      })}
      overlay={
        <>
          {savingKickReward && <SavingOverlay label={t('admin.saving', { defaultValue: 'Saving…' })} />}
          {kickSavedPulse && !savingKickReward && <SavedOverlay label={t('admin.saved', { defaultValue: 'Saved' })} />}
        </>
      }
      right={
        <HelpTooltip content={t('help.settings.rewards.enableKickReward', { defaultValue: 'Enable/disable Kick rewards → coins.' })}>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={rewardSettings.kickRewardEnabled}
              disabled={savingKickReward}
              onChange={(e) => {
                const nextEnabled = e.target.checked;
                if (nextEnabled && kickBackendUnsupported) {
                  toast.error(
                    t('admin.kickBackendNotReady', {
                      defaultValue: 'Kick rewards are temporarily unavailable (backend database is not migrated yet).',
                    }),
                  );
                  return;
                }
                if (nextEnabled && !kickLinked) {
                  toast.error(
                    t('admin.kickNotLinked', {
                      defaultValue: 'Kick account is not linked. Link Kick in Settings → Accounts.',
                    }),
                  );
                  return;
                }
                if (nextEnabled) {
                  onChangeRewardSettings((p) => ({
                    ...p,
                    kickRewardEnabled: true,
                    kickCoinPerPointRatio: String(p.kickCoinPerPointRatio || '').trim() ? p.kickCoinPerPointRatio : '1',
                  }));
                  return;
                }
                onChangeRewardSettings((p) => ({ ...p, kickRewardEnabled: false }));
              }}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/20 dark:peer-focus:ring-primary/30 rounded-full peer dark:bg-gray-600 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-primary"></div>
          </label>
        </HelpTooltip>
      }
      contentClassName={rewardSettings.kickRewardEnabled ? 'space-y-4' : undefined}
    >
      {kickLastErrorRequestId && (
        <p className="text-xs text-gray-600 dark:text-gray-400 select-text">
          {t('common.errorId', { defaultValue: 'Error ID' })}: <span className="font-mono">{kickLastErrorRequestId}</span>
        </p>
      )}
      {kickBackendUnsupported && (
        <p className="text-sm text-yellow-700 dark:text-yellow-300">
          {t('admin.kickBackendNotReady', {
            defaultValue: 'Kick rewards are temporarily unavailable (backend database is not migrated yet).',
          })}
        </p>
      )}
      {!kickLinked && (
        <p className="text-sm text-yellow-700 dark:text-yellow-300">
          {t('admin.kickNotLinked', { defaultValue: 'Kick account is not linked. Link Kick in Settings → Accounts.' })}
        </p>
      )}
      <p className="text-xs text-gray-500 dark:text-gray-400">
        {t('admin.kickRewardsPrereqHint', {
          defaultValue: 'Важно: также нужно настроить интеграцию во вкладке Bots (kickChannelId), иначе события не будут сопоставлены с каналом.',
        })}
      </p>

      {rewardSettings.kickRewardEnabled && (
        <div className={savingKickReward ? 'pointer-events-none opacity-60' : ''}>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="text-sm font-medium text-gray-700 dark:text-gray-300">
                {t('admin.rewardOnlyWhenLiveTitle', { defaultValue: 'Active only when stream is live' })}
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                {t('admin.kickRewardOnlyWhenLiveHint', {
                  defaultValue: 'If enabled, coins are granted only when your Kick stream is live.',
                })}
              </div>
            </div>
            <HelpTooltip
              content={t('help.settings.rewards.onlyWhenLiveKick', {
                defaultValue: 'If enabled, Kick rewards grant coins only when live.',
              })}
            >
              <label className="relative inline-flex items-center cursor-pointer shrink-0">
                <input
                  type="checkbox"
                  checked={rewardSettings.kickRewardOnlyWhenLive}
                  disabled={savingKickReward}
                  onChange={(e) => onChangeRewardSettings((p) => ({ ...p, kickRewardOnlyWhenLive: e.target.checked }))}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/20 dark:peer-focus:ring-primary/30 rounded-full peer dark:bg-gray-600 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-primary"></div>
              </label>
            </HelpTooltip>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {t('admin.kickRewardIdForCoins', { defaultValue: 'kickRewardIdForCoins (optional)' })}
            </label>
            <Input
              type="text"
              value={rewardSettings.kickRewardIdForCoins}
              onChange={(e) => onChangeRewardSettings((p) => ({ ...p, kickRewardIdForCoins: e.target.value }))}
              placeholder={t('admin.kickRewardIdPlaceholder', { defaultValue: 'reward_123 (leave empty = any reward)' })}
            />
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              {t('admin.kickRewardIdHint', { defaultValue: 'If set, coins are granted only for this rewardId.' })}
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t('admin.kickCoinPerPointRatio', { defaultValue: 'kickCoinPerPointRatio' })}
              </label>
              <Input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={rewardSettings.kickCoinPerPointRatio}
                onChange={(e) => {
                  const next = e.target.value.replace(/[^\d]/g, '');
                  onChangeRewardSettings((p) => ({ ...p, kickCoinPerPointRatio: next }));
                }}
                onKeyDown={(e) => {
                  if (e.key === 'e' || e.key === 'E' || e.key === '+' || e.key === '-' || e.key === '.') {
                    e.preventDefault();
                  }
                }}
                placeholder="1"
              />
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 min-h-[2.25rem]">
                {t('admin.kickCoinPerPointRatioHint', {
                  defaultValue: 'coins = points * ratio (used when kickRewardCoins is empty).',
                })}
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t('admin.kickRewardCoins', { defaultValue: 'kickRewardCoins (optional)' })}
              </label>
              <Input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={rewardSettings.kickRewardCoins}
                onChange={(e) => {
                  const next = e.target.value.replace(/[^\d]/g, '');
                  onChangeRewardSettings((p) => ({ ...p, kickRewardCoins: next }));
                }}
                onKeyDown={(e) => {
                  if (e.key === 'e' || e.key === 'E' || e.key === '+' || e.key === '-' || e.key === '.') {
                    e.preventDefault();
                  }
                }}
                placeholder="(empty)"
              />
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 min-h-[2.25rem]">
                {t('admin.kickRewardCoinsHint', { defaultValue: 'Fixed coins. If set, it overrides ratio.' })}
              </p>
            </div>
          </div>
        </div>
      )}
    </SettingsSection>
  );
}
