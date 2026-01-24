import { useTranslation } from 'react-i18next';

import type { AutoRewardsEnabledKey, KvRow } from '@/features/settings/tabs/rewards/twitch-auto-rewards/model/types';
import type { TwitchAutoRewardsV1 } from '@/types';
import type { Dispatch, SetStateAction } from 'react';

import { bool, intOrEmpty, recordFromRows } from '@/features/settings/tabs/rewards/twitch-auto-rewards/model/utils';
import { PlatformBadges } from '@/features/settings/tabs/rewards/twitch-auto-rewards/ui/PlatformBadges';
import { Button, Input } from '@/shared/ui';

type ChatRewardsSectionProps = {
  value: TwitchAutoRewardsV1;
  disabled?: boolean;
  thresholdCoinsRows: KvRow[];
  setThresholdCoinsRows: Dispatch<SetStateAction<KvRow[]>>;
  dailyStreakRows: KvRow[];
  setDailyStreakRows: Dispatch<SetStateAction<KvRow[]>>;
  markDirty: () => void;
  setEnabled: (key: AutoRewardsEnabledKey, enabled: boolean) => void;
  patch: (next: TwitchAutoRewardsV1) => void;
};

export function ChatRewardsSection({
  value,
  disabled,
  thresholdCoinsRows,
  setThresholdCoinsRows,
  dailyStreakRows,
  setDailyStreakRows,
  markDirty,
  setEnabled,
  patch,
}: ChatRewardsSectionProps) {
  const { t } = useTranslation();

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div className="rounded-xl bg-white/40 dark:bg-white/5 ring-1 ring-black/5 dark:ring-white/10 p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <div className="font-semibold text-gray-900 dark:text-white">
              {t('admin.autoRewardsChatThresholds', { defaultValue: 'Чат: пороги сообщений' })}
            </div>
            <PlatformBadges platforms={['TW', 'K', 'TR', 'VK']} />
          </div>
          <label className="relative inline-flex items-center cursor-pointer shrink-0">
            <input
              type="checkbox"
              checked={bool(value.chat?.messageThresholds?.enabled)}
              aria-label="Enable chat message thresholds auto reward"
              disabled={disabled}
              onChange={(e) => setEnabled('chatThresholds', e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/20 dark:peer-focus:ring-primary/30 rounded-full peer dark:bg-gray-600 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-primary"></div>
          </label>
        </div>
        <div className="text-xs text-gray-500 dark:text-gray-400">
          {t('admin.autoRewardsChatThresholdsHint', {
            defaultValue: 'coinsByThreshold: threshold → coins. (thresholds вычисляется из ключей.)',
          })}
        </div>
        <div className="flex items-center justify-between gap-2">
          <div />
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="glass-btn bg-white/40 dark:bg-white/5"
            onClick={() => {
              markDirty();
              setThresholdCoinsRows((p) => [...p, { key: '', value: '' }]);
            }}
          >
            {t('admin.autoRewardsAdd', { defaultValue: 'Добавить' })}
          </Button>
        </div>
        <div className="space-y-2">
          {thresholdCoinsRows.map((row, idx) => (
            <div key={idx} className="grid grid-cols-1 sm:grid-cols-[1fr_180px_auto] gap-2 items-end">
              <Input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={row.key}
                onChange={(e) => {
                  const key = e.target.value.replace(/[^\d]/g, '');
                  markDirty();
                  setThresholdCoinsRows((p) => p.map((r, i) => (i === idx ? { ...r, key } : r)));
                }}
                placeholder="messages"
              />
              <Input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={row.value}
                onChange={(e) => {
                  const valueStr = e.target.value.replace(/[^\d]/g, '');
                  markDirty();
                  setThresholdCoinsRows((p) => p.map((r, i) => (i === idx ? { ...r, value: valueStr } : r)));
                }}
                placeholder="coins"
              />
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="glass-btn bg-white/40 dark:bg-white/5"
                onClick={() => {
                  markDirty();
                  setThresholdCoinsRows((p) => p.filter((_, i) => i !== idx));
                }}
              >
                {t('admin.autoRewardsRemove', { defaultValue: 'Удалить' })}
              </Button>
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between gap-2">
          <label className="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
            <input
              type="checkbox"
              checked={bool(value.chat?.messageThresholds?.onlyWhenLive)}
              disabled={disabled}
              onChange={(e) =>
                patch({
                  ...value,
                  chat: { ...(value.chat ?? {}), messageThresholds: { ...(value.chat?.messageThresholds ?? {}), onlyWhenLive: e.target.checked } },
                })
              }
            />
            {t('admin.autoRewardsOnlyWhenLive', { defaultValue: 'Только когда стрим в онлайне' })}
          </label>
          <Button
            type="button"
            size="sm"
            variant="primary"
            onClick={() => {
              const coinsByThreshold = recordFromRows(thresholdCoinsRows);
              const thresholds = Object.keys(coinsByThreshold)
                .map((x) => Number.parseInt(x, 10))
                .filter((n) => Number.isFinite(n) && n > 0)
                .sort((a, b) => a - b);

              patch({
                ...value,
                chat: {
                  ...(value.chat ?? {}),
                  messageThresholds: {
                    ...(value.chat?.messageThresholds ?? {}),
                    thresholds,
                    coinsByThreshold,
                  },
                },
              });
            }}
          >
            {t('admin.autoRewardsApplyThresholds', { defaultValue: 'Применить thresholds' })}
          </Button>
        </div>
      </div>

      <div className="rounded-xl bg-white/40 dark:bg-white/5 ring-1 ring-black/5 dark:ring-white/10 p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <div className="font-semibold text-gray-900 dark:text-white">
              {t('admin.autoRewardsChatDailyStreak', { defaultValue: 'Чат: ежедневная серия' })}
            </div>
            <PlatformBadges platforms={['TW', 'K', 'TR', 'VK']} />
          </div>
          <label className="relative inline-flex items-center cursor-pointer shrink-0">
            <input
              type="checkbox"
              checked={bool(value.chat?.dailyStreak?.enabled)}
              aria-label="Enable chat daily streak auto reward"
              disabled={disabled}
              onChange={(e) => setEnabled('chatDailyStreak', e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/20 dark:peer-focus:ring-primary/30 rounded-full peer dark:bg-gray-600 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-primary"></div>
          </label>
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-700 dark:text-gray-200 mb-1">coinsPerDay</label>
          <Input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            value={intOrEmpty(value.chat?.dailyStreak?.coinsPerDay)}
            onChange={(e) => {
              const coinsPerDay = Number.parseInt(e.target.value.replace(/[^\d]/g, '') || '0', 10) || 0;
              patch({
                ...value,
                chat: { ...(value.chat ?? {}), dailyStreak: { ...(value.chat?.dailyStreak ?? {}), coinsPerDay } },
              });
            }}
            placeholder="0"
          />
        </div>

        <div className="flex items-center justify-between gap-2">
          <div className="text-xs text-gray-500 dark:text-gray-400">
            {t('admin.autoRewardsChatDailyStreakHint', { defaultValue: 'coinsByStreak: streakDay → coins' })}
          </div>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="glass-btn bg-white/40 dark:bg-white/5"
            onClick={() => {
              markDirty();
              setDailyStreakRows((p) => [...p, { key: '', value: '' }]);
            }}
          >
            {t('admin.autoRewardsAdd', { defaultValue: 'Добавить' })}
          </Button>
        </div>

        <div className="space-y-2">
          {dailyStreakRows.map((row, idx) => (
            <div key={idx} className="grid grid-cols-1 sm:grid-cols-[1fr_180px_auto] gap-2 items-end">
              <Input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={row.key}
                onChange={(e) => {
                  const key = e.target.value.replace(/[^\d]/g, '');
                  markDirty();
                  setDailyStreakRows((p) => p.map((r, i) => (i === idx ? { ...r, key } : r)));
                }}
                placeholder="day"
              />
              <Input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={row.value}
                onChange={(e) => {
                  const valueStr = e.target.value.replace(/[^\d]/g, '');
                  markDirty();
                  setDailyStreakRows((p) => p.map((r, i) => (i === idx ? { ...r, value: valueStr } : r)));
                }}
                placeholder="coins"
              />
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="glass-btn bg-white/40 dark:bg-white/5"
                onClick={() => {
                  markDirty();
                  setDailyStreakRows((p) => p.filter((_, i) => i !== idx));
                }}
              >
                {t('admin.autoRewardsRemove', { defaultValue: 'Удалить' })}
              </Button>
            </div>
          ))}
        </div>

        <Button
          type="button"
          size="sm"
          variant="primary"
          onClick={() =>
            patch({
              ...value,
              chat: { ...(value.chat ?? {}), dailyStreak: { ...(value.chat?.dailyStreak ?? {}), coinsByStreak: recordFromRows(dailyStreakRows) } },
            })
          }
        >
          {t('admin.autoRewardsApplyCoinsByStreak', { defaultValue: 'Применить coinsByStreak' })}
        </Button>
      </div>
    </div>
  );
}
