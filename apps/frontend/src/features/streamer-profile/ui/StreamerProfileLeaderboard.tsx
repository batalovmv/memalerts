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
    limit: 6,
    enabled: !!channelSlug,
  });

  const rows = useMemo(
    () =>
      stats.map((entry, index) => {
        const meme = entry.meme;
        const title = meme?.title?.trim() || t('common.unknown', { defaultValue: 'Unknown' });
        const tags = Array.isArray(meme?.tags)
          ? meme.tags
              .map((tag) => tag?.tag?.name)
              .filter((name): name is string => typeof name === 'string' && name.trim().length > 0)
              .slice(0, 2)
          : [];
        return {
          id: meme?.id ?? `${index}`,
          index,
          title,
          tags,
          activations: entry.activationsCount ?? 0,
          coins: entry.totalCoinsSpent ?? 0,
        };
      }),
    [stats, t],
  );

  return (
    <section className="mb-6 rounded-2xl border border-white/10 bg-white/70 dark:bg-white/5 p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase tracking-[0.22em] text-gray-500">
            {t('profile.leaderboardEyebrow', { defaultValue: 'Leaderboard' })}
          </div>
          <h3 className="mt-2 text-xl font-bold text-gray-900 dark:text-white">
            {t('profile.leaderboardTitle', { defaultValue: 'Top memes' })}
          </h3>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
            {t('profile.leaderboardHint', {
              defaultValue: 'Based on viewer activations and coins spent.',
            })}
          </p>
        </div>
        <div
          className={cn(
            'inline-flex items-center gap-1 rounded-full border border-gray-200/70 dark:border-white/10',
            'bg-white/70 dark:bg-gray-900/50 p-1 shadow-sm',
          )}
        >
          {([
            { value: 7 as const, label: t('profile.leaderboardPeriodWeek', { defaultValue: '7 days' }) },
            { value: 30 as const, label: t('profile.leaderboardPeriodMonth', { defaultValue: '30 days' }) },
          ] as const).map((option) => {
            const isActive = periodDays === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => onChangePeriod(option.value)}
                className={cn(
                  'px-3 py-1.5 text-xs font-semibold rounded-full transition-colors',
                  isActive
                    ? 'bg-primary text-white shadow-[0_6px_14px_rgba(10,132,255,0.25)]'
                    : 'text-gray-700 dark:text-gray-200 hover:bg-white/80 dark:hover:bg-white/10',
                )}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-4">
        {loading ? (
          <div className="flex items-center gap-3 py-6 text-gray-600 dark:text-gray-300">
            <Spinner className="h-5 w-5" />
            <span>{t('common.loading', { defaultValue: 'Loading...' })}</span>
          </div>
        ) : error ? (
          <div className="rounded-xl border border-rose-200/60 bg-rose-50/70 dark:border-rose-500/30 dark:bg-rose-500/10 p-4 text-sm text-rose-700 dark:text-rose-200">
            {t('profile.leaderboardError', { defaultValue: 'Failed to load leaderboard.' })}
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-xl border border-black/5 dark:border-white/10 bg-white/60 dark:bg-white/5 p-4 text-sm text-gray-600 dark:text-gray-300">
            {t('profile.leaderboardEmpty', { defaultValue: 'No leaderboard data yet.' })}
          </div>
        ) : (
          <div className="space-y-2">
            {rows.map((row) => (
              <div
                key={row.id}
                className="flex items-center gap-3 rounded-xl border border-black/5 dark:border-white/10 bg-white/60 dark:bg-gray-900/40 p-3"
              >
                <span
                  className={cn(
                    'flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold shadow-sm',
                    rankBadgeClass(row.index),
                  )}
                >
                  {row.index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-gray-900 dark:text-white truncate">{row.title}</div>
                  {row.tags.length > 0 ? (
                    <div className="mt-1 flex flex-wrap gap-1 text-xs text-gray-500 dark:text-gray-400">
                      {row.tags.map((tag) => (
                        <span key={tag}>#{tag}</span>
                      ))}
                    </div>
                  ) : null}
                </div>
                <div className="text-right text-xs text-gray-600 dark:text-gray-300">
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
