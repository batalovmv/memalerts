import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { AutoRewardsEditorProps } from '@/features/settings/tabs/rewards/twitch-auto-rewards/model/types';

import { useAutoRewardsEditorState } from '@/features/settings/tabs/rewards/twitch-auto-rewards/model/useAutoRewardsEditorState';
import { ChannelPointsMappingBlock } from '@/features/settings/tabs/rewards/twitch-auto-rewards/ui/ChannelPointsMappingBlock';
import { ChatRewardsSection } from '@/features/settings/tabs/rewards/twitch-auto-rewards/ui/ChatRewardsSection';
import { CoreRewardsSection } from '@/features/settings/tabs/rewards/twitch-auto-rewards/ui/CoreRewardsSection';
import { GiftCheerSection } from '@/features/settings/tabs/rewards/twitch-auto-rewards/ui/GiftCheerSection';
import { SubscribeResubSection } from '@/features/settings/tabs/rewards/twitch-auto-rewards/ui/SubscribeResubSection';

export type { AutoRewardsEditorProps, AutoRewardsEditorVariant } from '@/features/settings/tabs/rewards/twitch-auto-rewards/model/types';

export const AutoRewardsEditor = memo(function AutoRewardsEditor({
  value,
  onChange,
  disabled,
  variant = 'all',
}: AutoRewardsEditorProps) {
  const { t } = useTranslation();
  const {
    v,
    hasAnyEnabled,
    channelPointsRows,
    setChannelPointsRows,
    subscribeTierRows,
    setSubscribeTierRows,
    resubTierRows,
    setResubTierRows,
    giftGiverTierRows,
    setGiftGiverTierRows,
    thresholdCoinsRows,
    setThresholdCoinsRows,
    dailyStreakRows,
    setDailyStreakRows,
    markDirty,
    patch,
    setEnabled,
  } = useAutoRewardsEditorState({ value, onChange, variant });

  const rootClassName = disabled ? 'pointer-events-none opacity-60 space-y-3' : 'space-y-3';
  const showChannelPoints = variant !== 'noChannelPoints';

  const channelPointsBlock = (
    <ChannelPointsMappingBlock
      value={v}
      disabled={disabled}
      rows={channelPointsRows}
      setRows={setChannelPointsRows}
      markDirty={markDirty}
      setEnabled={setEnabled}
      patch={patch}
    />
  );

  if (variant === 'channelPointsOnly') {
    return (
      <div className={rootClassName}>
        <div className="text-xs text-gray-500 dark:text-gray-400">
          {t('admin.autoRewardsTwitchOnlyHint', {
            defaultValue: 'Twitch-only: channel points mapping. Stored in the same auto-rewards JSON.',
          })}
        </div>
        {channelPointsBlock}
      </div>
    );
  }

  return (
    <div className={rootClassName}>
      <div className="text-xs text-gray-500 dark:text-gray-400">
        {t('admin.autoRewardsSharedConfigHint', {
          defaultValue: 'Общая конфигурация: применяется там, где бэкенд поддерживает событие (Twitch/Kick/Trovo/VKVideo).',
        })}
      </div>

      {!hasAnyEnabled ? (
        <div className="rounded-xl bg-white/30 dark:bg-white/5 ring-1 ring-black/5 dark:ring-white/10 p-4 text-sm text-gray-700 dark:text-gray-200">
          {t('admin.autoRewardsAllDisabled', { defaultValue: 'Все автонаграды сейчас отключены. Включите нужные события ниже.' })}
        </div>
      ) : null}

      <CoreRewardsSection value={v} disabled={disabled} setEnabled={setEnabled} patch={patch} />

      <details className="rounded-xl bg-white/30 dark:bg-white/5 ring-1 ring-black/5 dark:ring-white/10 p-4">
        <summary className="cursor-pointer select-none font-semibold text-gray-900 dark:text-white">
          {t('admin.autoRewardsAdvanced', { defaultValue: 'Расширенное' })}
        </summary>
        <div className="mt-3 space-y-4">
          {showChannelPoints ? channelPointsBlock : null}

          <SubscribeResubSection
            value={v}
            disabled={disabled}
            subscribeTierRows={subscribeTierRows}
            setSubscribeTierRows={setSubscribeTierRows}
            resubTierRows={resubTierRows}
            setResubTierRows={setResubTierRows}
            markDirty={markDirty}
            setEnabled={setEnabled}
            patch={patch}
          />

          <GiftCheerSection
            value={v}
            disabled={disabled}
            giftGiverTierRows={giftGiverTierRows}
            setGiftGiverTierRows={setGiftGiverTierRows}
            markDirty={markDirty}
            setEnabled={setEnabled}
            patch={patch}
          />

          <ChatRewardsSection
            value={v}
            disabled={disabled}
            thresholdCoinsRows={thresholdCoinsRows}
            setThresholdCoinsRows={setThresholdCoinsRows}
            dailyStreakRows={dailyStreakRows}
            setDailyStreakRows={setDailyStreakRows}
            markDirty={markDirty}
            setEnabled={setEnabled}
            patch={patch}
          />
        </div>
      </details>
    </div>
  );
});
