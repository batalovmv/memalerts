import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { AchievementSnapshot } from '@memalerts/api-contracts';

import { Button, Spinner } from '@/shared/ui';

type StreamerProfileAchievementsProps = {
  achievements: AchievementSnapshot | null;
  loading: boolean;
  error: string | null;
  isAuthed: boolean;
  onReload: () => void;
};

function formatProgress(progress?: number, target?: number): string {
  if (typeof progress !== 'number' || typeof target !== 'number') return '';
  return `${progress}/${target}`;
}

function formatEventDate(value?: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString();
}

export function StreamerProfileAchievements({
  achievements,
  loading,
  error,
  isAuthed,
  onReload,
}: StreamerProfileAchievementsProps) {
  const { t } = useTranslation();

  const globalList = achievements?.global ?? [];
  const channelList = achievements?.channel ?? [];
  const eventList = achievements?.events ?? [];

  const hasAny = globalList.length > 0 || channelList.length > 0 || eventList.length > 0;

  const sortedGlobal = useMemo(() => {
    return [...globalList].sort((a, b) => {
      const aUnlocked = a.achievedAt ? 1 : 0;
      const bUnlocked = b.achievedAt ? 1 : 0;
      return bUnlocked - aUnlocked;
    });
  }, [globalList]);

  const sortedChannel = useMemo(() => {
    return [...channelList].sort((a, b) => {
      const aUnlocked = a.achievedAt ? 1 : 0;
      const bUnlocked = b.achievedAt ? 1 : 0;
      return bUnlocked - aUnlocked;
    });
  }, [channelList]);

  const eventGroups = useMemo(() => {
    const map = new Map<
      string,
      { eventKey: string; eventTitle: string; eventEndsAt?: string; items: typeof eventList }
    >();
    for (const item of eventList) {
      const key = item.eventKey;
      if (!map.has(key)) {
        map.set(key, {
          eventKey: key,
          eventTitle: item.eventTitle,
          eventEndsAt: item.eventEndsAt,
          items: [],
        });
      }
      map.get(key)!.items.push(item);
    }
    return Array.from(map.values()).map((group) => ({
      ...group,
      items: [...group.items].sort((a, b) => {
        const aUnlocked = a.achievedAt ? 1 : 0;
        const bUnlocked = b.achievedAt ? 1 : 0;
        return bUnlocked - aUnlocked;
      }),
    }));
  }, [eventList]);

  if (!isAuthed) return null;

  return (
    <section className="mb-4 rounded-xl border border-white/10 bg-white/70 dark:bg-white/5 p-3 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-semibold text-gray-900 dark:text-white">
          {t('achievements.title', { defaultValue: 'Achievements' })}
        </div>
        <Button type="button" size="sm" variant="secondary" onClick={onReload} disabled={loading}>
          {t('achievements.refresh', { defaultValue: 'Refresh' })}
        </Button>
      </div>

      {loading ? (
        <div className="mt-3 flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
          <Spinner className="h-4 w-4" />
          {t('achievements.loading', { defaultValue: 'Loading achievements…' })}
        </div>
      ) : error ? (
        <div className="mt-3 text-xs text-red-500">{error}</div>
      ) : !hasAny ? (
        <div className="mt-3 text-xs text-gray-500 dark:text-gray-400">
          {t('achievements.empty', { defaultValue: 'No achievements yet.' })}
        </div>
      ) : (
        <div className="mt-3 space-y-4">
          {sortedGlobal.length > 0 ? (
            <div>
              <div className="text-xs font-semibold text-gray-600 dark:text-gray-300 mb-2">
                {t('achievements.global', { defaultValue: 'Global' })}
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {sortedGlobal.map((item) => {
                  const unlocked = !!item.achievedAt;
                  const progressLabel = unlocked ? t('achievements.unlocked', { defaultValue: 'Unlocked' }) : formatProgress(item.progress, item.target);
                  return (
                    <div
                      key={item.key}
                      className={`rounded-lg border border-black/5 dark:border-white/10 p-2 ${unlocked ? 'bg-white/70 dark:bg-white/10' : 'bg-white/40 dark:bg-white/5 opacity-70'}`}
                    >
                      <div className="text-sm font-semibold text-gray-900 dark:text-white">{item.title}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">{item.description}</div>
                      {progressLabel ? (
                        <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">{progressLabel}</div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          {sortedChannel.length > 0 ? (
            <div>
              <div className="text-xs font-semibold text-gray-600 dark:text-gray-300 mb-2">
                {t('achievements.channel', { defaultValue: 'Channel' })}
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {sortedChannel.map((item) => {
                  const unlocked = !!item.achievedAt;
                  const progressLabel = unlocked ? t('achievements.unlocked', { defaultValue: 'Unlocked' }) : formatProgress(item.progress, item.target);
                  const rewardLabel = item.rewardCoins
                    ? t('achievements.reward', { defaultValue: '+{{count}} coins', count: item.rewardCoins })
                    : '';
                  return (
                    <div
                      key={item.key}
                      className={`rounded-lg border border-black/5 dark:border-white/10 p-2 ${unlocked ? 'bg-white/70 dark:bg-white/10' : 'bg-white/40 dark:bg-white/5 opacity-70'}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-sm font-semibold text-gray-900 dark:text-white">{item.title}</div>
                        {rewardLabel ? <div className="text-[11px] text-emerald-600 dark:text-emerald-400">{rewardLabel}</div> : null}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">{item.description}</div>
                      {progressLabel ? (
                        <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">{progressLabel}</div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          {eventGroups.length > 0 ? (
            <div>
              <div className="text-xs font-semibold text-gray-600 dark:text-gray-300 mb-2">
                {t('achievements.event', { defaultValue: 'Event' })}
              </div>
              <div className="space-y-3">
                {eventGroups.map((group) => {
                  const endsLabel = formatEventDate(group.eventEndsAt);
                  return (
                    <div key={group.eventKey} className="rounded-lg border border-black/5 dark:border-white/10 p-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-xs font-semibold text-gray-700 dark:text-gray-200">
                          {group.eventTitle}
                        </div>
                        {endsLabel ? (
                          <div className="text-[11px] text-gray-500 dark:text-gray-400">
                            {t('achievements.eventEnds', { defaultValue: 'until {{date}}', date: endsLabel })}
                          </div>
                        ) : null}
                      </div>
                      <div className="mt-2 grid gap-2 sm:grid-cols-2">
                        {group.items.map((item) => {
                          const unlocked = !!item.achievedAt;
                          const progressLabel = unlocked
                            ? t('achievements.unlocked', { defaultValue: 'Unlocked' })
                            : formatProgress(item.progress, item.target);
                          const rewardLabel = item.rewardCoins
                            ? t('achievements.reward', { defaultValue: '+{{count}} coins', count: item.rewardCoins })
                            : '';
                          return (
                            <div
                              key={item.key}
                              className={`rounded-lg border border-black/5 dark:border-white/10 p-2 ${unlocked ? 'bg-white/70 dark:bg-white/10' : 'bg-white/40 dark:bg-white/5 opacity-70'}`}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <div className="text-sm font-semibold text-gray-900 dark:text-white">{item.title}</div>
                                {rewardLabel ? (
                                  <div className="text-[11px] text-emerald-600 dark:text-emerald-400">{rewardLabel}</div>
                                ) : null}
                              </div>
                              <div className="text-xs text-gray-500 dark:text-gray-400">{item.description}</div>
                              {progressLabel ? (
                                <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">{progressLabel}</div>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
