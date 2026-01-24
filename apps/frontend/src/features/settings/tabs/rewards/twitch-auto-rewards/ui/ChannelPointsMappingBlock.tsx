import { useTranslation } from 'react-i18next';

import type { AutoRewardsEnabledKey, KvRow } from '@/features/settings/tabs/rewards/twitch-auto-rewards/model/types';
import type { TwitchAutoRewardsV1 } from '@/types';
import type { Dispatch, SetStateAction } from 'react';

import { bool, recordFromRows } from '@/features/settings/tabs/rewards/twitch-auto-rewards/model/utils';
import { PlatformBadges } from '@/features/settings/tabs/rewards/twitch-auto-rewards/ui/PlatformBadges';
import { Button, Input } from '@/shared/ui';

type ChannelPointsMappingBlockProps = {
  value: TwitchAutoRewardsV1;
  disabled?: boolean;
  rows: KvRow[];
  setRows: Dispatch<SetStateAction<KvRow[]>>;
  markDirty: () => void;
  setEnabled: (key: AutoRewardsEnabledKey, enabled: boolean) => void;
  patch: (next: TwitchAutoRewardsV1) => void;
};

export function ChannelPointsMappingBlock({
  value,
  disabled,
  rows,
  setRows,
  markDirty,
  setEnabled,
  patch,
}: ChannelPointsMappingBlockProps) {
  const { t } = useTranslation();

  return (
    <div className="rounded-xl bg-white/40 dark:bg-white/5 ring-1 ring-black/5 dark:ring-white/10 p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <div className="font-semibold text-gray-900 dark:text-white">
            {t('admin.autoRewardsChannelPointsMapping', { defaultValue: 'Channel Points: rewardId → coins' })}
          </div>
          <PlatformBadges platforms={['TW']} />
        </div>
        <label className="relative inline-flex items-center cursor-pointer shrink-0">
          <input
            type="checkbox"
            checked={bool(value.channelPoints?.enabled)}
            aria-label="Enable channel points auto reward"
            disabled={disabled}
            onChange={(e) => setEnabled('channelPoints', e.target.checked)}
            className="sr-only peer"
          />
          <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/20 dark:peer-focus:ring-primary/30 rounded-full peer dark:bg-gray-600 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-primary"></div>
        </label>
      </div>
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs text-gray-500 dark:text-gray-400">
          {t('admin.autoRewardsChannelPointsKeysHint', { defaultValue: 'Ключи — это reward.id из Twitch.' })}
        </div>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="glass-btn bg-white/40 dark:bg-white/5"
          onClick={() => {
            markDirty();
            setRows((p) => [...p, { key: '', value: '' }]);
          }}
        >
          {t('admin.autoRewardsAdd', { defaultValue: 'Добавить' })}
        </Button>
      </div>
      <div className="space-y-2">
        {rows.length === 0 ? (
          <div className="text-sm text-gray-600 dark:text-gray-300">
            {t('admin.autoRewardsNoMappingsYet', { defaultValue: 'Пока нет сопоставлений.' })}
          </div>
        ) : (
          rows.map((row, idx) => (
            <div key={idx} className="grid grid-cols-1 sm:grid-cols-[1fr_180px_auto] gap-2 items-end">
              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-200 mb-1">rewardId</label>
                <Input
                  type="text"
                  value={row.key}
                  onChange={(e) => {
                    const key = e.target.value;
                    markDirty();
                    setRows((p) => p.map((r, i) => (i === idx ? { ...r, key } : r)));
                  }}
                  placeholder="abc123..."
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-200 mb-1">
                  {t('admin.autoRewardsCoinsLower', { defaultValue: 'монеты' })}
                </label>
                <Input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={row.value}
                  onChange={(e) => {
                    const valueStr = e.target.value.replace(/[^\d]/g, '');
                    markDirty();
                    setRows((p) => p.map((r, i) => (i === idx ? { ...r, value: valueStr } : r)));
                  }}
                  placeholder="0"
                />
              </div>
              <div className="flex justify-end">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="glass-btn bg-white/40 dark:bg-white/5"
                  onClick={() => {
                    markDirty();
                    setRows((p) => p.filter((_, i) => i !== idx));
                  }}
                >
                  {t('admin.autoRewardsRemove', { defaultValue: 'Удалить' })}
                </Button>
              </div>
            </div>
          ))
        )}
      </div>
      <div className="flex items-center justify-between gap-2">
        <label className="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
          <input
            type="checkbox"
            checked={bool(value.channelPoints?.onlyWhenLive)}
            disabled={disabled}
            onChange={(e) =>
              patch({ ...value, channelPoints: { ...(value.channelPoints ?? {}), onlyWhenLive: e.target.checked } })
            }
          />
          {t('admin.autoRewardsOnlyWhenLive', { defaultValue: 'Только когда стрим в онлайне' })}
        </label>
        <Button
          type="button"
          size="sm"
          variant="primary"
          onClick={() =>
            patch({
              ...value,
              channelPoints: { ...(value.channelPoints ?? {}), byRewardId: recordFromRows(rows) },
            })
          }
        >
          {t('admin.autoRewardsApplyMappings', { defaultValue: 'Применить' })}
        </Button>
      </div>
    </div>
  );
}
