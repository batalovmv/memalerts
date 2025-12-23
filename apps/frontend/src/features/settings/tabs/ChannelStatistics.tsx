import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';

export function ChannelStatistics() {
  const { t } = useTranslation();
  const [stats, setStats] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const statsLoadedRef = useRef(false);

  const fetchStats = useCallback(async () => {
    if (statsLoadedRef.current) return; // Prevent duplicate requests
    
    try {
      setLoading(true);
      statsLoadedRef.current = true;
      const { api } = await import('@/lib/api');
      const stats = await api.get<Record<string, unknown>>('/streamer/stats/channel');
      setStats(stats);
    } catch (error: unknown) {
      const apiError = error as { response?: { data?: { error?: string } } };
      statsLoadedRef.current = false; // Reset on error to allow retry
      toast.error(apiError.response?.data?.error || t('admin.failedToLoadStatistics') || 'Failed to load statistics');
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  if (loading) {
    return <div className="text-center py-8">{t('admin.loadingStatistics')}</div>;
  }

  if (!stats) {
    return <div className="text-center py-8 text-gray-500 dark:text-gray-400">{t('admin.noStatistics')}</div>;
  }

  const daily = (stats.daily as Array<{ day: string; activations: number; coins: number }> | undefined) || [];
  const maxDailyActivations = daily.reduce((m, d) => Math.max(m, d.activations || 0), 0) || 1;
  const maxDailyCoins = daily.reduce((m, d) => Math.max(m, d.coins || 0), 0) || 1;

  return (
    <div className="space-y-6">
      {/* Activity chart (last 14 days) */}
      <div className="surface p-6">
        <h2 className="text-2xl font-bold mb-4 dark:text-white">
          {t('admin.activityLast14Days', { defaultValue: 'Activity (last 14 days)' })}
        </h2>
        {daily.length === 0 ? (
          <div className="text-sm text-gray-600 dark:text-gray-400">
            {t('admin.noActivityYet', { defaultValue: 'No activity yet.' })}
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <div className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                {t('admin.dailyActivations', { defaultValue: 'Daily activations' })}
              </div>
              <div className="grid grid-cols-14 gap-1 items-end h-24">
                {daily.slice(-14).map((d) => {
                  const h = Math.round(((d.activations || 0) / maxDailyActivations) * 100);
                  const label = new Date(d.day).toLocaleDateString();
                  return (
                    <div key={`a-${d.day}`} className="h-full flex items-end">
                      <div
                        className="w-full rounded bg-primary/70"
                        style={{ height: `${Math.max(3, h)}%` }}
                        title={`${label}: ${d.activations || 0}`}
                      />
                    </div>
                  );
                })}
              </div>
            </div>

            <div>
              <div className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                {t('admin.dailyCoinsSpent', { defaultValue: 'Daily coins spent' })}
              </div>
              <div className="grid grid-cols-14 gap-1 items-end h-24">
                {daily.slice(-14).map((d) => {
                  const h = Math.round(((d.coins || 0) / maxDailyCoins) * 100);
                  const label = new Date(d.day).toLocaleDateString();
                  return (
                    <div key={`c-${d.day}`} className="h-full flex items-end">
                      <div
                        className="w-full rounded bg-accent/70"
                        style={{ height: `${Math.max(3, h)}%` }}
                        title={`${label}: ${d.coins || 0}`}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Overall Stats */}
      <div className="surface p-6">
        <h2 className="text-2xl font-bold mb-4 dark:text-white">{t('admin.overallStatistics') || 'Overall Statistics'}</h2>
        <div className="grid grid-cols-3 gap-4">
          <div className="text-center p-4 bg-primary/10 rounded-xl ring-1 ring-primary/20">
            <p className="text-3xl font-bold text-primary">{(stats.overall as { totalActivations: number })?.totalActivations || 0}</p>
            <p className="text-sm text-gray-600 dark:text-gray-400">{t('admin.totalActivations')}</p>
          </div>
          <div className="text-center p-4 bg-accent/10 rounded-xl ring-1 ring-accent/20">
            <p className="text-3xl font-bold text-accent">{(stats.overall as { totalCoinsSpent: number })?.totalCoinsSpent || 0}</p>
            <p className="text-sm text-gray-600 dark:text-gray-400">{t('admin.totalCoinsSpent')}</p>
          </div>
          <div className="text-center p-4 bg-secondary/10 rounded-xl ring-1 ring-secondary/20">
            <p className="text-3xl font-bold text-secondary">{(stats.overall as { totalMemes: number })?.totalMemes || 0}</p>
            <p className="text-sm text-gray-600 dark:text-gray-400">{t('admin.totalMemes')}</p>
          </div>
        </div>
      </div>

      {/* Top Users */}
      <div className="surface p-6">
        <h2 className="text-2xl font-bold mb-4 dark:text-white">{t('admin.topUsersBySpending')}</h2>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-black/5 dark:border-white/10">
                <th className="text-left p-2 text-gray-700 dark:text-gray-300">{t('admin.user')}</th>
                <th className="text-left p-2 text-gray-700 dark:text-gray-300">{t('admin.activations')}</th>
                <th className="text-left p-2 text-gray-700 dark:text-gray-300">{t('admin.totalCoins')}</th>
              </tr>
            </thead>
            <tbody>
              {Array.isArray(stats.userSpending) && stats.userSpending.map((item: Record<string, unknown>) => {
                const i = item as { user: { id: string; displayName: string }; activationsCount: number; totalCoinsSpent: number };
                return (
                <tr key={i.user.id} className="border-b border-black/5 dark:border-white/10">
                  <td className="p-2 text-gray-900 dark:text-gray-100">{i.user.displayName}</td>
                  <td className="p-2 text-gray-900 dark:text-gray-100">{i.activationsCount}</td>
                  <td className="p-2 font-bold text-accent">{i.totalCoinsSpent}</td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Top Memes */}
      <div className="surface p-6">
        <h2 className="text-2xl font-bold mb-4 dark:text-white">{t('admin.mostPopularMemes')}</h2>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-black/5 dark:border-white/10">
                <th className="text-left p-2 text-gray-700 dark:text-gray-300">{t('admin.meme')}</th>
                <th className="text-left p-2 text-gray-700 dark:text-gray-300">{t('admin.activations')}</th>
                <th className="text-left p-2 text-gray-700 dark:text-gray-300">{t('admin.totalCoins')}</th>
              </tr>
            </thead>
            <tbody>
              {Array.isArray(stats.memePopularity) && stats.memePopularity.map((item: Record<string, unknown>, index: number) => {
                const i = item as { meme?: { id: string; title: string }; activationsCount: number; totalCoinsSpent: number };
                return (
                <tr key={i.meme?.id || index} className="border-b border-black/5 dark:border-white/10">
                  <td className="p-2 text-gray-900 dark:text-gray-100">{i.meme?.title || t('common.unknown') || 'Unknown'}</td>
                  <td className="p-2 text-gray-900 dark:text-gray-100">{i.activationsCount}</td>
                  <td className="p-2 font-bold text-accent">{i.totalCoinsSpent}</td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}


