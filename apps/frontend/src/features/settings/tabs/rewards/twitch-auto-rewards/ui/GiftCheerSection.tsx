import { useTranslation } from 'react-i18next';

import type { AutoRewardsEnabledKey, KvRow } from '@/features/settings/tabs/rewards/twitch-auto-rewards/model/types';
import type { TwitchAutoRewardsV1 } from '@/types';
import type { Dispatch, SetStateAction } from 'react';

import { bool, intOrEmpty, recordFromRows } from '@/features/settings/tabs/rewards/twitch-auto-rewards/model/utils';
import { PlatformBadges } from '@/features/settings/tabs/rewards/twitch-auto-rewards/ui/PlatformBadges';
import { Button, Input } from '@/shared/ui';

type GiftCheerSectionProps = {
  value: TwitchAutoRewardsV1;
  disabled?: boolean;
  giftGiverTierRows: KvRow[];
  setGiftGiverTierRows: Dispatch<SetStateAction<KvRow[]>>;
  markDirty: () => void;
  setEnabled: (key: AutoRewardsEnabledKey, enabled: boolean) => void;
  patch: (next: TwitchAutoRewardsV1) => void;
};

export function GiftCheerSection({
  value,
  disabled,
  giftGiverTierRows,
  setGiftGiverTierRows,
  markDirty,
  setEnabled,
  patch,
}: GiftCheerSectionProps) {
  const { t } = useTranslation();

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div className="rounded-xl bg-white/40 dark:bg-white/5 ring-1 ring-black/5 dark:ring-white/10 p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <div className="font-semibold text-gray-900 dark:text-white">{t('admin.autoRewardsGiftSubs', { defaultValue: 'Подарочные подписки' })}</div>
            <PlatformBadges platforms={['TW', 'K', 'TR']} />
          </div>
          <label className="relative inline-flex items-center cursor-pointer shrink-0">
            <input
              type="checkbox"
              checked={bool(value.giftSub?.enabled)}
              aria-label="Enable gift sub auto reward"
              disabled={disabled}
              onChange={(e) => setEnabled('giftSub', e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/20 dark:peer-focus:ring-primary/30 rounded-full peer dark:bg-gray-600 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-primary"></div>
          </label>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-200 mb-1">
              {t('admin.autoRewardsGiftRecipientCoins', { defaultValue: 'Монеты получателя' })}
            </label>
            <Input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={intOrEmpty(value.giftSub?.recipientCoins)}
              onChange={(e) => {
                const recipientCoins = Number.parseInt(e.target.value.replace(/[^\d]/g, '') || '0', 10) || 0;
                patch({ ...value, giftSub: { ...(value.giftSub ?? {}), recipientCoins } });
              }}
              placeholder="0"
            />
          </div>
          <div className="flex items-end">
            <label className="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
              <input
                type="checkbox"
                checked={bool(value.giftSub?.onlyWhenLive)}
                disabled={disabled}
                onChange={(e) => patch({ ...value, giftSub: { ...(value.giftSub ?? {}), onlyWhenLive: e.target.checked } })}
              />
              {t('admin.autoRewardsOnlyWhenLive', { defaultValue: 'Только когда стрим в онлайне' })}
            </label>
          </div>
        </div>
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs text-gray-500 dark:text-gray-400">
            {t('admin.autoRewardsGiverTierCoinsHint', { defaultValue: 'giverTierCoins: tierKey → coins' })}
          </div>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="glass-btn bg-white/40 dark:bg-white/5"
            onClick={() => {
              markDirty();
              setGiftGiverTierRows((p) => [...p, { key: '', value: '' }]);
            }}
          >
            {t('admin.autoRewardsAdd', { defaultValue: 'Добавить' })}
          </Button>
        </div>
        <div className="space-y-2">
          {giftGiverTierRows.map((row, idx) => (
            <div key={idx} className="grid grid-cols-1 sm:grid-cols-[1fr_180px_auto] gap-2 items-end">
              <Input
                type="text"
                value={row.key}
                onChange={(e) => {
                  const key = e.target.value;
                  markDirty();
                  setGiftGiverTierRows((p) => p.map((r, i) => (i === idx ? { ...r, key } : r)));
                }}
                placeholder="T1"
              />
              <Input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={row.value}
                onChange={(e) => {
                  const valueStr = e.target.value.replace(/[^\d]/g, '');
                  markDirty();
                  setGiftGiverTierRows((p) => p.map((r, i) => (i === idx ? { ...r, value: valueStr } : r)));
                }}
                placeholder="0"
              />
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="glass-btn bg-white/40 dark:bg-white/5"
                onClick={() => {
                  markDirty();
                  setGiftGiverTierRows((p) => p.filter((_, i) => i !== idx));
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
            patch({ ...value, giftSub: { ...(value.giftSub ?? {}), giverTierCoins: recordFromRows(giftGiverTierRows) } })
          }
        >
          {t('admin.autoRewardsApplyGiverTierCoins', { defaultValue: 'Применить giverTierCoins' })}
        </Button>
      </div>

      <div className="rounded-xl bg-white/40 dark:bg-white/5 ring-1 ring-black/5 dark:ring-white/10 p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <div className="font-semibold text-gray-900 dark:text-white">
              {t('admin.autoRewardsCheer', { defaultValue: 'Cheer / подарки (bits/kicks)' })}
            </div>
            <PlatformBadges platforms={['TW', 'K']} />
          </div>
          <label className="relative inline-flex items-center cursor-pointer shrink-0">
            <input
              type="checkbox"
              checked={bool(value.cheer?.enabled)}
              aria-label="Enable cheer auto reward"
              disabled={disabled}
              onChange={(e) => setEnabled('cheer', e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/20 dark:peer-focus:ring-primary/30 rounded-full peer dark:bg-gray-600 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-primary"></div>
          </label>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-200 mb-1">bitsPerCoin</label>
            <Input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={intOrEmpty(value.cheer?.bitsPerCoin)}
              onChange={(e) => {
                const bitsPerCoin = Number.parseInt(e.target.value.replace(/[^\d]/g, '') || '0', 10) || 0;
                patch({ ...value, cheer: { ...(value.cheer ?? {}), bitsPerCoin } });
              }}
              placeholder="0"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-200 mb-1">minBits</label>
            <Input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={intOrEmpty(value.cheer?.minBits)}
              onChange={(e) => {
                const minBits = Number.parseInt(e.target.value.replace(/[^\d]/g, '') || '0', 10) || 0;
                patch({ ...value, cheer: { ...(value.cheer ?? {}), minBits } });
              }}
              placeholder="0"
            />
          </div>
          <div className="flex items-end">
            <label className="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
              <input
                type="checkbox"
                checked={bool(value.cheer?.onlyWhenLive)}
                disabled={disabled}
                onChange={(e) => patch({ ...value, cheer: { ...(value.cheer ?? {}), onlyWhenLive: e.target.checked } })}
              />
              {t('admin.autoRewardsOnlyWhenLive', { defaultValue: 'Только когда стрим в онлайне' })}
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}
