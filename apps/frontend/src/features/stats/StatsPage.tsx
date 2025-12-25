import { useState, useEffect, useCallback } from 'react';

import { api } from '@/lib/api';
import Header from '@/components/Header';
import { useAppSelector } from '@/store/hooks';

export default function Stats() {
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
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900">
      <Header />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-6 surface p-6">
          <div className="flex items-center gap-4 mb-4">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Period:</label>
            <select
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              className="rounded-xl px-3 py-2.5 text-sm bg-white/60 dark:bg-white/10 text-gray-900 dark:text-white shadow-sm outline-none ring-1 ring-black/5 dark:ring-white/10 focus:ring-2 focus:ring-primary/40"
            >
              <option value="day">Last 24 hours</option>
              <option value="week">Last week</option>
              <option value="month">Last month</option>
              <option value="year">Last year</option>
              <option value="all">All time</option>
            </select>
          </div>

          {loading ? (
            <div className="text-center py-8 text-gray-600 dark:text-gray-300">Loading statistics...</div>
          ) : stats && (stats.stats as Array<unknown>)?.length > 0 ? (
            <div className="space-y-4">
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Top Memes</h2>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-black/5 dark:border-white/10">
                      <th className="text-left p-2 text-gray-700 dark:text-gray-300">Rank</th>
                      <th className="text-left p-2 text-gray-700 dark:text-gray-300">Meme</th>
                      <th className="text-left p-2 text-gray-700 dark:text-gray-300">Activations</th>
                      <th className="text-left p-2 text-gray-700 dark:text-gray-300">Total Coins</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Array.isArray(stats.stats) && (stats.stats as Array<Record<string, unknown>>).map((stat: Record<string, unknown>, index: number) => {
                      const s = stat as { meme?: { id: string; title: string }; activationsCount: number; totalCoinsSpent: number };
                      return (
                        <tr key={s.meme?.id || index} className="border-b border-black/5 dark:border-white/10">
                          <td className="p-2 font-bold text-gray-900 dark:text-gray-100">#{index + 1}</td>
                          <td className="p-2 text-gray-900 dark:text-gray-100">{s.meme?.title || 'Unknown'}</td>
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
            <div className="text-center py-8 text-gray-500 dark:text-gray-400">No statistics available</div>
          )}
        </div>
      </main>
    </div>
  );
}


