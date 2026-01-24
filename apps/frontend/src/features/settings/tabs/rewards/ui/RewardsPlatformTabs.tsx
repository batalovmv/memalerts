import { useTranslation } from 'react-i18next';

import type { RewardsPlatformId } from '@/features/settings/tabs/rewards/types';

type RewardsPlatformTabsProps = {
  activePlatform: RewardsPlatformId;
  onChange: (next: RewardsPlatformId) => void;
  autoRewardsLinked: boolean;
  twitchLinked: boolean;
  youtubeLinked: boolean;
  kickLinked: boolean;
  vkvideoLinked: boolean;
  trovoLinked: boolean;
};

export function RewardsPlatformTabs({
  activePlatform,
  onChange,
  autoRewardsLinked,
  twitchLinked,
  youtubeLinked,
  kickLinked,
  vkvideoLinked,
  trovoLinked,
}: RewardsPlatformTabsProps) {
  const { t } = useTranslation();
  const tabs: Array<{ id: RewardsPlatformId; label: string; linked: boolean }> = [
    { id: 'common', label: t('admin.commonRewardsTab', { defaultValue: 'Общие' }), linked: autoRewardsLinked },
    { id: 'twitch', label: 'Twitch', linked: twitchLinked },
    { id: 'youtube', label: 'YouTube', linked: youtubeLinked },
    { id: 'kick', label: 'Kick', linked: kickLinked },
    { id: 'vkvideo', label: 'VKVideo', linked: vkvideoLinked },
    { id: 'trovo', label: 'Trovo', linked: trovoLinked },
    { id: 'submissions', label: t('admin.submissions', { defaultValue: 'Заявки' }), linked: true },
    { id: 'boosty', label: 'Boosty', linked: true },
  ];

  return (
    <div className="glass p-2 sm:p-3">
      <div className="flex gap-2 overflow-x-auto no-scrollbar">
        {tabs.map((p) => {
          const active = activePlatform === p.id;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => onChange(p.id)}
              className={[
                'shrink-0 rounded-xl px-3 py-2 text-sm font-semibold transition-colors',
                active
                  ? 'bg-primary text-white'
                  : 'bg-white/40 dark:bg-white/5 text-gray-800 dark:text-gray-200 hover:bg-white/60 dark:hover:bg-white/10',
              ].join(' ')}
            >
              <span className="inline-flex items-center gap-2">
                <span className={['inline-block h-2 w-2 rounded-full', p.linked ? 'bg-emerald-500' : 'bg-gray-400'].join(' ')} />
                <span>{p.label}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
