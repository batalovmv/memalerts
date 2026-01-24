import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

import type { RewardSettingsState } from '@/features/settings/tabs/rewards/types';
import type { Dispatch, SetStateAction } from 'react';

import { SettingsSection } from '@/features/settings/ui/SettingsSection';
import { HelpTooltip, Input } from '@/shared/ui';
import { SavedOverlay, SavingOverlay } from '@/shared/ui/StatusOverlays';

type VkvideoRewardsSectionProps = {
  rewardSettings: RewardSettingsState;
  onChangeRewardSettings: Dispatch<SetStateAction<RewardSettingsState>>;
  savingVkvideoReward: boolean;
  vkvideoSavedPulse: boolean;
  vkvideoLastErrorRequestId: string | null;
  vkvideoLinked: boolean;
};

export function VkvideoRewardsSection({
  rewardSettings,
  onChangeRewardSettings,
  savingVkvideoReward,
  vkvideoSavedPulse,
  vkvideoLastErrorRequestId,
  vkvideoLinked,
}: VkvideoRewardsSectionProps) {
  const { t } = useTranslation();

  return (
    <SettingsSection
      title={t('admin.vkvideoCoinsRewardTitle', { defaultValue: 'Награда за монеты (VKVideo)' })}
      description={t('admin.vkvideoCoinsRewardDescription', {
        defaultValue: 'Зритель активирует награду на VKVideo и получает монеты на сайте.',
      })}
      overlay={
        <>
          {savingVkvideoReward && <SavingOverlay label={t('admin.saving', { defaultValue: 'Saving…' })} />}
          {vkvideoSavedPulse && !savingVkvideoReward && <SavedOverlay label={t('admin.saved', { defaultValue: 'Saved' })} />}
        </>
      }
      right={
        <HelpTooltip content={t('help.settings.rewards.enableVkvideoReward', { defaultValue: 'Enable/disable VKVideo rewards → coins.' })}>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={rewardSettings.vkvideoRewardEnabled}
              disabled={savingVkvideoReward}
              onChange={(e) => {
                const nextEnabled = e.target.checked;
                if (nextEnabled && !vkvideoLinked) {
                  toast.error(
                    t('admin.vkvideoNotLinked', {
                      defaultValue: 'VKVideo account is not linked. Link VKVideo in Settings → Accounts.',
                    }),
                  );
                  return;
                }
                if (nextEnabled) {
                  onChangeRewardSettings((p) => ({
                    ...p,
                    vkvideoRewardEnabled: true,
                    vkvideoCoinPerPointRatio: String(p.vkvideoCoinPerPointRatio || '').trim() ? p.vkvideoCoinPerPointRatio : '1',
                  }));
                  return;
                }
                onChangeRewardSettings((p) => ({ ...p, vkvideoRewardEnabled: false }));
              }}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/20 dark:peer-focus:ring-primary/30 rounded-full peer dark:bg-gray-600 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-primary"></div>
          </label>
        </HelpTooltip>
      }
      contentClassName={rewardSettings.vkvideoRewardEnabled ? 'space-y-4' : undefined}
    >
      {vkvideoLastErrorRequestId && (
        <p className="text-xs text-gray-600 dark:text-gray-400 select-text">
          {t('common.errorId', { defaultValue: 'Error ID' })}: <span className="font-mono">{vkvideoLastErrorRequestId}</span>
        </p>
      )}
      {!vkvideoLinked && (
        <p className="text-sm text-yellow-700 dark:text-yellow-300">
          {t('admin.vkvideoNotLinked', { defaultValue: 'VKVideo account is not linked. Link VKVideo in Settings → Accounts.' })}
        </p>
      )}
      <p className="text-xs text-gray-500 dark:text-gray-400">
        {t('admin.vkvideoRewardsPrereqHint', {
          defaultValue:
            'Важно: чтобы награды приходили, нужно (1) привязать VKVideo аккаунт и (2) включить бота во вкладке Bots (PATCH /streamer/bots/vkvideo { enabled: true }).',
        })}
      </p>

      {rewardSettings.vkvideoRewardEnabled && (
        <div className={savingVkvideoReward ? 'pointer-events-none opacity-60' : ''}>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="text-sm font-medium text-gray-700 dark:text-gray-300">
                {t('admin.rewardOnlyWhenLiveTitle', { defaultValue: 'Active only when stream is live' })}
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                {t('admin.vkvideoRewardOnlyWhenLiveHint', {
                  defaultValue: 'If enabled, coins are granted only when your VKVideo stream is live.',
                })}
              </div>
            </div>
            <HelpTooltip
              content={t('help.settings.rewards.onlyWhenLiveVkvideo', { defaultValue: 'If enabled, VKVideo rewards grant coins only when live.' })}
            >
              <label className="relative inline-flex items-center cursor-pointer shrink-0">
                <input
                  type="checkbox"
                  checked={rewardSettings.vkvideoRewardOnlyWhenLive}
                  disabled={savingVkvideoReward}
                  onChange={(e) => onChangeRewardSettings((p) => ({ ...p, vkvideoRewardOnlyWhenLive: e.target.checked }))}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/20 dark:peer-focus:ring-primary/30 rounded-full peer dark:bg-gray-600 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-primary"></div>
              </label>
            </HelpTooltip>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {t('admin.vkvideoRewardIdForCoins', { defaultValue: 'vkvideoRewardIdForCoins (optional)' })}
            </label>
            <Input
              type="text"
              value={rewardSettings.vkvideoRewardIdForCoins}
              onChange={(e) => onChangeRewardSettings((p) => ({ ...p, vkvideoRewardIdForCoins: e.target.value }))}
              placeholder={t('admin.vkvideoRewardIdPlaceholder', { defaultValue: '(empty = any reward)' })}
            />
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              {t('admin.vkvideoRewardIdHint', { defaultValue: 'If set, coins are granted only for this rewardId.' })}
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t('admin.vkvideoCoinPerPointRatio', { defaultValue: 'vkvideoCoinPerPointRatio' })}
              </label>
              <Input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={rewardSettings.vkvideoCoinPerPointRatio}
                onChange={(e) => {
                  const next = e.target.value.replace(/[^\d]/g, '');
                  onChangeRewardSettings((p) => ({ ...p, vkvideoCoinPerPointRatio: next }));
                }}
                onKeyDown={(e) => {
                  if (e.key === 'e' || e.key === 'E' || e.key === '+' || e.key === '-' || e.key === '.') {
                    e.preventDefault();
                  }
                }}
                placeholder="1"
              />
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 min-h-[2.25rem]">
                {t('admin.vkvideoCoinPerPointRatioHint', {
                  defaultValue: 'coins = points * ratio (used when vkvideoRewardCoins is empty).',
                })}
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t('admin.vkvideoRewardCoins', { defaultValue: 'vkvideoRewardCoins (optional)' })}
              </label>
              <Input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={rewardSettings.vkvideoRewardCoins}
                onChange={(e) => {
                  const next = e.target.value.replace(/[^\d]/g, '');
                  onChangeRewardSettings((p) => ({ ...p, vkvideoRewardCoins: next }));
                }}
                onKeyDown={(e) => {
                  if (e.key === 'e' || e.key === 'E' || e.key === '+' || e.key === '-' || e.key === '.') {
                    e.preventDefault();
                  }
                }}
                placeholder="(empty)"
              />
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 min-h-[2.25rem]">
                {t('admin.vkvideoRewardCoinsHint', { defaultValue: 'Fixed coins. If set, it overrides ratio.' })}
              </p>
            </div>
          </div>
        </div>
      )}
    </SettingsSection>
  );
}
