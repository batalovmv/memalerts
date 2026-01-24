import { useTranslation } from 'react-i18next';

import type { AutoRewardsEnabledKey } from '@/features/settings/tabs/rewards/twitch-auto-rewards/model/types';
import type { TwitchAutoRewardsV1 } from '@/types';

import { bool, intOrEmpty } from '@/features/settings/tabs/rewards/twitch-auto-rewards/model/utils';
import { PlatformBadges } from '@/features/settings/tabs/rewards/twitch-auto-rewards/ui/PlatformBadges';
import { Input } from '@/shared/ui';

type CoreRewardsSectionProps = {
  value: TwitchAutoRewardsV1;
  disabled?: boolean;
  setEnabled: (key: AutoRewardsEnabledKey, enabled: boolean) => void;
  patch: (next: TwitchAutoRewardsV1) => void;
};

export function CoreRewardsSection({ value, disabled, setEnabled, patch }: CoreRewardsSectionProps) {
  const { t } = useTranslation();

  return (
    <details className="rounded-xl bg-white/30 dark:bg-white/5 ring-1 ring-black/5 dark:ring-white/10 p-4" open>
      <summary className="cursor-pointer select-none font-semibold text-gray-900 dark:text-white">
        {t('admin.autoRewardsCore', { defaultValue: 'Основное' })}
      </summary>
      <div className="mt-3 space-y-4">
        {/* Follow */}
        <div className="rounded-xl bg-white/40 dark:bg-white/5 ring-1 ring-black/5 dark:ring-white/10 p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <div className="font-semibold text-gray-900 dark:text-white">{t('admin.autoRewardsFollow', { defaultValue: 'Фоллоу' })}</div>
              <PlatformBadges platforms={['TW', 'K', 'TR']} />
            </div>
            <label className="relative inline-flex items-center cursor-pointer shrink-0">
              <input
                type="checkbox"
                checked={bool(value.follow?.enabled)}
                aria-label="Enable follow auto reward"
                disabled={disabled}
                onChange={(e) => setEnabled('follow', e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/20 dark:peer-focus:ring-primary/30 rounded-full peer dark:bg-gray-600 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-primary"></div>
            </label>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-200 mb-1">
                {t('admin.autoRewardsCoins', { defaultValue: 'Монеты' })}
              </label>
              <Input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                aria-label="Follow coins"
                value={intOrEmpty(value.follow?.coins)}
                onChange={(e) => {
                  const coins = Number.parseInt(e.target.value.replace(/[^\d]/g, '') || '0', 10) || 0;
                  patch({ ...value, follow: { ...(value.follow ?? {}), coins } });
                }}
                placeholder="10"
              />
            </div>
            <div className="flex items-end gap-2">
              <label className="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
                <input
                  type="checkbox"
                  checked={bool(value.follow?.onceEver)}
                  disabled={disabled}
                  onChange={(e) => patch({ ...value, follow: { ...(value.follow ?? {}), onceEver: e.target.checked } })}
                />
                {t('admin.autoRewardsOnceEver', { defaultValue: 'Один раз за всё время' })}
              </label>
            </div>
            <div className="flex items-end gap-2">
              <label className="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
                <input
                  type="checkbox"
                  checked={bool(value.follow?.onlyWhenLive)}
                  disabled={disabled}
                  onChange={(e) => patch({ ...value, follow: { ...(value.follow ?? {}), onlyWhenLive: e.target.checked } })}
                />
                {t('admin.autoRewardsOnlyWhenLive', { defaultValue: 'Только когда стрим в онлайне' })}
              </label>
            </div>
          </div>
        </div>

        {/* Raid */}
        <div className="rounded-xl bg-white/40 dark:bg-white/5 ring-1 ring-black/5 dark:ring-white/10 p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <div className="font-semibold text-gray-900 dark:text-white">{t('admin.autoRewardsRaid', { defaultValue: 'Рейд' })}</div>
              <PlatformBadges platforms={['TW', 'TR']} />
            </div>
            <label className="relative inline-flex items-center cursor-pointer shrink-0">
              <input
                type="checkbox"
                checked={bool(value.raid?.enabled)}
                aria-label="Enable raid auto reward"
                disabled={disabled}
                onChange={(e) => setEnabled('raid', e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/20 dark:peer-focus:ring-primary/30 rounded-full peer dark:bg-gray-600 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-primary"></div>
            </label>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-200 mb-1">Base coins</label>
              <Input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={intOrEmpty(value.raid?.baseCoins)}
                onChange={(e) => {
                  const baseCoins = Number.parseInt(e.target.value.replace(/[^\d]/g, '') || '0', 10) || 0;
                  patch({ ...value, raid: { ...(value.raid ?? {}), baseCoins } });
                }}
                placeholder="0"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-200 mb-1">Coins / viewer</label>
              <Input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={intOrEmpty(value.raid?.coinsPerViewer)}
                onChange={(e) => {
                  const coinsPerViewer = Number.parseInt(e.target.value.replace(/[^\d]/g, '') || '0', 10) || 0;
                  patch({ ...value, raid: { ...(value.raid ?? {}), coinsPerViewer } });
                }}
                placeholder="0"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-200 mb-1">Min viewers</label>
              <Input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={intOrEmpty(value.raid?.minViewers)}
                onChange={(e) => {
                  const minViewers = Number.parseInt(e.target.value.replace(/[^\d]/g, '') || '0', 10) || 0;
                  patch({ ...value, raid: { ...(value.raid ?? {}), minViewers } });
                }}
                placeholder="0"
              />
            </div>
            <div className="flex items-end">
              <label className="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
                <input
                  type="checkbox"
                  checked={bool(value.raid?.onlyWhenLive)}
                  disabled={disabled}
                  onChange={(e) => patch({ ...value, raid: { ...(value.raid ?? {}), onlyWhenLive: e.target.checked } })}
                />
                {t('admin.autoRewardsOnlyWhenLive', { defaultValue: 'Только когда стрим в онлайне' })}
              </label>
            </div>
          </div>
        </div>

        {/* Chat: first message */}
        <div className="rounded-xl bg-white/40 dark:bg-white/5 ring-1 ring-black/5 dark:ring-white/10 p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <div className="font-semibold text-gray-900 dark:text-white">
                {t('admin.autoRewardsChatFirstMessage', { defaultValue: 'Чат: первое сообщение' })}
              </div>
              <PlatformBadges platforms={['TW', 'K', 'TR', 'VK']} />
            </div>
            <label className="relative inline-flex items-center cursor-pointer shrink-0">
              <input
                type="checkbox"
                checked={bool(value.chat?.firstMessage?.enabled)}
                aria-label="Enable chat first message auto reward"
                disabled={disabled}
                onChange={(e) => setEnabled('chatFirstMessage', e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/20 dark:peer-focus:ring-primary/30 rounded-full peer dark:bg-gray-600 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-primary"></div>
            </label>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-200 mb-1">
                {t('admin.autoRewardsCoins', { defaultValue: 'Монеты' })}
              </label>
              <Input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={intOrEmpty(value.chat?.firstMessage?.coins)}
                onChange={(e) => {
                  const coins = Number.parseInt(e.target.value.replace(/[^\d]/g, '') || '0', 10) || 0;
                  patch({
                    ...value,
                    chat: { ...(value.chat ?? {}), firstMessage: { ...(value.chat?.firstMessage ?? {}), coins } },
                  });
                }}
                placeholder="0"
              />
            </div>
            <div className="flex items-end">
              <label className="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
                <input
                  type="checkbox"
                  checked={bool(value.chat?.firstMessage?.onlyWhenLive)}
                  disabled={disabled}
                  onChange={(e) =>
                    patch({
                      ...value,
                      chat: {
                        ...(value.chat ?? {}),
                        firstMessage: { ...(value.chat?.firstMessage ?? {}), onlyWhenLive: e.target.checked },
                      },
                    })
                  }
                />
                {t('admin.autoRewardsOnlyWhenLive', { defaultValue: 'Только когда стрим в онлайне' })}
              </label>
            </div>
          </div>
        </div>
      </div>
    </details>
  );
}
