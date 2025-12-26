import { useState, useEffect, useCallback } from 'react';

import { useTranslation } from 'react-i18next';

import Header from '@/components/Header';
import { api } from '@/lib/api';
import { PageShell, Select, Spinner } from '@/shared/ui';
import { useAppSelector } from '@/store/hooks';

export default function Stats() {
  const { t } = useTranslation();
  const { user } = useAppSelector((state) => state.auth);
  const [period, setPeriod] = useState('month');
  const [stats, setStats] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchStats = useCallback(async () => {
    setLoading(true);
    try {
      const stats = await api.get<Record<string, unknown>>(`/memes/stats?period=${period}&channelId=${user?.channelId}&limit=10`);
      setStats(stats);
    } catch (error: unknown) {
      setStats(null);
    } finally {
      setLoading(false);
    }
  }, [period, user?.channelId]);

  useEffect(() => {
    if (user?.channelId) {
      fetchStats();
    }
  }, [fetchStats, user?.channelId]);

  if (!user) {
    return null;
  }

  return (
    <PageShell header={<Header />}>
      <div className="section-gap">
        <div className="surface p-6">
          <div className="flex items-center gap-4 mb-4">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('stats.period', { defaultValue: 'Period' })}:
            </label>
            <Select
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
            >
              <option value="day">{t('stats.periodDay', { defaultValue: 'Last 24 hours' })}</option>
              <option value="week">{t('stats.periodWeek', { defaultValue: 'Last week' })}</option>
              <option value="month">{t('stats.periodMonth', { defaultValue: 'Last month' })}</option>
              <option value="year">{t('stats.periodYear', { defaultValue: 'Last year' })}</option>
              <option value="all">{t('stats.periodAll', { defaultValue: 'All time' })}</option>
            </Select>
          </div>

          {loading ? (
            <div className="flex items-center justify-center gap-3 py-10 text-gray-600 dark:text-gray-300">
              <Spinner className="h-5 w-5" />
              <span>{t('common.loading', { defaultValue: 'Loading…' })}</span>
            </div>
          ) : stats && (stats.stats as Array<unknown>)?.length > 0 ? (
            <div className="space-y-4">
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
                {t('stats.topMemes', { defaultValue: 'Top memes' })}
              </h2>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-black/5 dark:border-white/10">
                      <th className="text-left p-2 text-gray-700 dark:text-gray-300">
                        {t('stats.rank', { defaultValue: 'Rank' })}
                      </th>
                      <th className="text-left p-2 text-gray-700 dark:text-gray-300">
                        {t('stats.meme', { defaultValue: 'Meme' })}
                      </th>
                      <th className="text-left p-2 text-gray-700 dark:text-gray-300">
                        {t('stats.activations', { defaultValue: 'Activations' })}
                      </th>
                      <th className="text-left p-2 text-gray-700 dark:text-gray-300">
                        {t('stats.totalCoins', { defaultValue: 'Total coins' })}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {Array.isArray(stats.stats) && (stats.stats as Array<Record<string, unknown>>).map((stat: Record<string, unknown>, index: number) => {
                      const s = stat as { meme?: { id: string; title: string }; activationsCount: number; totalCoinsSpent: number };
                      return (
                        <tr key={s.meme?.id || index} className="border-b border-black/5 dark:border-white/10">
                          <td className="p-2 font-bold text-gray-900 dark:text-gray-100">#{index + 1}</td>
                          <td className="p-2 text-gray-900 dark:text-gray-100">
                            {s.meme?.title || t('common.unknown', { defaultValue: 'Unknown' })}
                          </td>
                          <td className="p-2 text-gray-900 dark:text-gray-100">{s.activationsCount}</td>
                          <td className="p-2 font-bold text-accent">{s.totalCoinsSpent}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="surface p-6 text-center">
              <div className="text-base font-semibold text-gray-900 dark:text-white">
                {t('stats.noData', { defaultValue: 'No statistics available' })}
              </div>
              <div className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                {t('stats.noDataHint', { defaultValue: 'Try selecting a different period.' })}
              </div>
            </div>
          )}
        </div>
      </div>
    </PageShell>
  );
}


