import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { StreamRecap } from '@memalerts/api-contracts';

import { Button, Spinner } from '@/shared/ui';

type DashboardStreamRecapPanelProps = {
  recap: StreamRecap | null;
  loading: boolean;
  error: string | null;
  onReload: () => void;
};

function formatDateTime(value?: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString();
}

function formatDuration(start?: string | null, end?: string | null): string {
  if (!start) return '';
  const startDate = new Date(start);
  const endDate = end ? new Date(end) : new Date();
  const ms = Math.max(0, endDate.getTime() - startDate.getTime());
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours <= 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}

export function DashboardStreamRecapPanel({ recap, loading, error, onReload }: DashboardStreamRecapPanelProps) {
  const { t } = useTranslation();

  const sessionLabel = useMemo(() => {
    if (!recap?.session?.startedAt) return '';
    const start = formatDateTime(recap.session.startedAt);
    const end = recap.session.endedAt ? formatDateTime(recap.session.endedAt) : t('dashboard.recap.live', { defaultValue: 'Live' });
    return `${start} — ${end}`;
  }, [recap?.session?.endedAt, recap?.session?.startedAt, t]);

  const durationLabel = useMemo(() => {
    return formatDuration(recap?.session?.startedAt, recap?.session?.endedAt ?? null);
  }, [recap?.session?.endedAt, recap?.session?.startedAt]);

  return (
    <section className="surface p-6 rounded-2xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold dark:text-white">
            {t('dashboard.recap.title', { defaultValue: 'Stream recap' })}
          </h2>
          {sessionLabel ? (
            <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">{sessionLabel}</div>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {durationLabel ? (
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {t('dashboard.recap.duration', { defaultValue: 'Duration' })}: {durationLabel}
            </span>
          ) : null}
          <Button type="button" size="sm" variant="secondary" onClick={onReload} disabled={loading}>
            {t('dashboard.recap.refresh', { defaultValue: 'Refresh' })}
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="mt-4 flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
          <Spinner className="h-4 w-4" />
          {t('dashboard.recap.loading', { defaultValue: 'Loading recap…' })}
        </div>
      ) : error ? (
        <div className="mt-4 text-sm text-red-500">{error}</div>
      ) : !recap ? (
        <div className="mt-4 text-sm text-gray-500 dark:text-gray-400">
          {t('dashboard.recap.empty', { defaultValue: 'No recap available yet.' })}
        </div>
      ) : (
        <div className="mt-4 grid gap-4 lg:grid-cols-[1.2fr_1fr]">
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-xl bg-white/60 dark:bg-white/5 p-3">
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  {t('dashboard.recap.activations', { defaultValue: 'Activations' })}
                </div>
                <div className="text-lg font-semibold text-gray-900 dark:text-white">
                  {recap.summary.totalActivations}
                </div>
              </div>
              <div className="rounded-xl bg-white/60 dark:bg-white/5 p-3">
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  {t('dashboard.recap.viewers', { defaultValue: 'Viewers' })}
                </div>
                <div className="text-lg font-semibold text-gray-900 dark:text-white">
                  {recap.summary.uniqueViewers}
                </div>
              </div>
              <div className="rounded-xl bg-white/60 dark:bg-white/5 p-3">
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  {t('dashboard.recap.coins', { defaultValue: 'Coins spent' })}
                </div>
                <div className="text-lg font-semibold text-gray-900 dark:text-white">
                  {recap.summary.coinsSpent}
                </div>
              </div>
            </div>

            <div>
              <div className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-2">
                {t('dashboard.recap.topMemes', { defaultValue: 'Top memes' })}
              </div>
              <div className="space-y-2">
                {recap.topMemes.map((meme) => (
                  <div key={meme.id} className="flex items-center justify-between gap-3 rounded-lg bg-white/60 dark:bg-white/5 px-3 py-2">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-gray-900 dark:text-white truncate">{meme.title}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        {t('dashboard.recap.activations', { defaultValue: 'Activations' })}: {meme.activations ?? 0}
                      </div>
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      {t('dashboard.recap.coins', { defaultValue: 'Coins spent' })}: {meme.coinsSpent ?? 0}
                    </div>
                  </div>
                ))}
                {recap.topMemes.length === 0 ? (
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    {t('dashboard.recap.topMemesEmpty', { defaultValue: 'No activations yet.' })}
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <div className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-2">
                {t('dashboard.recap.topViewers', { defaultValue: 'Top viewers' })}
              </div>
              <div className="space-y-2">
                {recap.topViewers.map((viewer) => (
                  <div key={viewer.userId} className="flex items-center justify-between gap-3 rounded-lg bg-white/60 dark:bg-white/5 px-3 py-2">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-gray-900 dark:text-white truncate">{viewer.displayName}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        {t('dashboard.recap.activations', { defaultValue: 'Activations' })}: {viewer.activations}
                      </div>
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      {t('dashboard.recap.coins', { defaultValue: 'Coins spent' })}: {viewer.coinsSpent}
                    </div>
                  </div>
                ))}
                {recap.topViewers.length === 0 ? (
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    {t('dashboard.recap.topViewersEmpty', { defaultValue: 'No viewers yet.' })}
                  </div>
                ) : null}
              </div>
            </div>

            <div>
              <div className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-2">
                {t('dashboard.recap.newMemes', { defaultValue: 'New memes' })}
              </div>
              <div className="space-y-2">
                {recap.newMemes.map((meme) => (
                  <div key={meme.id} className="flex items-center justify-between gap-3 rounded-lg bg-white/60 dark:bg-white/5 px-3 py-2">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-gray-900 dark:text-white truncate">{meme.title}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        {meme.createdAt ? formatDateTime(meme.createdAt) : ''}
                      </div>
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      {t('dashboard.recap.price', { defaultValue: 'Price' })}: {meme.priceCoins}
                    </div>
                  </div>
                ))}
                {recap.newMemes.length === 0 ? (
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    {t('dashboard.recap.newMemesEmpty', { defaultValue: 'No new memes during this stream.' })}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
