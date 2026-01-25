import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { LeaderboardPeriodDays } from '@/features/streamer-profile/model/useStreamerProfileLeaderboard';

import { useStreamerProfileLeaderboard } from '@/features/streamer-profile/model/useStreamerProfileLeaderboard';
import { cn } from '@/shared/lib/cn';
import { Spinner } from '@/shared/ui';

type StreamerProfileLeaderboardProps = {
  channelSlug: string;
  periodDays: LeaderboardPeriodDays;
  onChangePeriod: (next: LeaderboardPeriodDays) => void;
};

const rankBadgeClass = (index: number) => {
  if (index === 0) return 'bg-amber-400 text-black';
  if (index === 1) return 'bg-slate-200 text-slate-800';
  if (index === 2) return 'bg-rose-200 text-rose-900';
  return 'bg-black/5 text-gray-600 dark:bg-white/10 dark:text-gray-300';
};

export function StreamerProfileLeaderboard({ channelSlug, periodDays, onChangePeriod }: StreamerProfileLeaderboardProps) {
  const { t } = useTranslation();
  const { stats, loading, error } = useStreamerProfileLeaderboard({
    channelSlug,
    periodDays,
    limit: 3,
    enabled: !!channelSlug,
  });

  const rows = useMemo(
    () =>
      stats.map((entry, index) => {
        const meme = entry.meme;
        const title = meme?.title?.trim() || t('common.unknown', { defaultValue: 'Unknown' });
        return {
          id: meme?.id ?? `${index}`,
          index,
          title,
          activations: entry.activationsCount ?? 0,
          coins: entry.totalCoinsSpent ?? 0,
        };
      }),
    [stats, t],
  );

  return (
    <section className="mb-4 rounded-xl border border-white/10 bg-white/70 dark:bg-white/5 p-3 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-semibold text-gray-900 dark:text-white">
          {t('profile.leaderboardTitle', { defaultValue: 'Top memes' })}
        </div>
        <div
          className={cn(
            'inline-flex items-center gap-1 rounded-full border border-gray-200/70 dark:border-white/10',
            'bg-white/70 dark:bg-gray-900/50 p-1 shadow-sm',
          )}
        >
          {([
            { value: 7 as const, label: t('profile.leaderboardPeriodWeek', { defaultValue: '7d' }) },
            { value: 30 as const, label: t('profile.leaderboardPeriodMonth', { defaultValue: '30d' }) },
          ] as const).map((option) => {
            const isActive = periodDays === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => onChangePeriod(option.value)}
                className={cn(
                  'px-2.5 py-1 text-[11px] font-semibold rounded-full transition-colors',
                  isActive
                    ? 'bg-primary text-white shadow-[0_6px_12px_rgba(10,132,255,0.2)]'
                    : 'text-gray-700 dark:text-gray-200 hover:bg-white/80 dark:hover:bg-white/10',
                )}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-2">
        {loading ? (
          <div className="flex items-center gap-2 py-3 text-gray-600 dark:text-gray-300 text-sm">
            <Spinner className="h-4 w-4" />
            <span>{t('common.loading', { defaultValue: 'Loading...' })}</span>
          </div>
        ) : error ? (
          <div className="rounded-lg border border-rose-200/60 bg-rose-50/70 dark:border-rose-500/30 dark:bg-rose-500/10 p-3 text-xs text-rose-700 dark:text-rose-200">
            {t('profile.leaderboardError', { defaultValue: 'Failed to load leaderboard.' })}
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-lg border border-black/5 dark:border-white/10 bg-white/60 dark:bg-white/5 p-3 text-xs text-gray-600 dark:text-gray-300">
            {t('profile.leaderboardEmpty', { defaultValue: 'No leaderboard data yet.' })}
          </div>
        ) : (
          <div className="space-y-1.5">
            {rows.map((row) => (
              <div
                key={row.id}
                className="flex items-center gap-2 rounded-lg border border-black/5 dark:border-white/10 bg-white/60 dark:bg-gray-900/40 p-2"
              >
                <span
                  className={cn(
                    'flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold shadow-sm',
                    rankBadgeClass(row.index),
                  )}
                >
                  {row.index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-gray-900 dark:text-white truncate">{row.title}</div>
                </div>
                <div className="text-right text-[11px] text-gray-600 dark:text-gray-300">
                  <div className="font-semibold text-gray-900 dark:text-white">
                    {t('profile.leaderboardActivations', {
                      defaultValue: '{{count}} activations',
                      count: row.activations,
                    })}
                  </div>
                  <div className="text-accent font-semibold">
                    {t('profile.leaderboardCoins', {
                      defaultValue: '{{count}} coins',
                      count: row.coins,
                    })}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
