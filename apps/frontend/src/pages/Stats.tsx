import { useState, useEffect, useCallback } from 'react';
import { useAppSelector } from '../store/hooks';
import { api } from '../lib/api';
import UserMenu from '../components/UserMenu';

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
      console.error('Failed to fetch stats:', error);
    } finally {
      setLoading(false);
    }
  }, [period, user?.channelId]);

  useEffect(() => {
    if (user?.channelId) {
      fetchStats();
    }
  }, [fetchStats]);

  if (!user) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <nav className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 items-center">
            <h1 className="text-xl font-bold">Mem Alerts - Statistics</h1>
            <UserMenu />
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-6 bg-white rounded-lg shadow p-6">
          <div className="flex items-center gap-4 mb-4">
            <label className="text-sm font-medium text-gray-700">Period:</label>
            <select
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2"
            >
              <option value="day">Last 24 hours</option>
              <option value="week">Last week</option>
              <option value="month">Last month</option>
              <option value="year">Last year</option>
              <option value="all">All time</option>
            </select>
          </div>

          {loading ? (
            <div className="text-center py-8">Loading statistics...</div>
          ) : stats && (stats.stats as Array<unknown>)?.length > 0 ? (
            <div className="space-y-4">
              <h2 className="text-2xl font-bold">Top Memes</h2>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left p-2">Rank</th>
                      <th className="text-left p-2">Meme</th>
                      <th className="text-left p-2">Activations</th>
                      <th className="text-left p-2">Total Coins</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Array.isArray(stats.stats) && (stats.stats as Array<Record<string, unknown>>).map((stat: Record<string, unknown>, index: number) => {
                      const s = stat as { meme?: { id: string; title: string }; activationsCount: number; totalCoinsSpent: number };
                      return (
                      <tr key={s.meme?.id || index} className="border-b">
                        <td className="p-2 font-bold">#{index + 1}</td>
                        <td className="p-2">{s.meme?.title || 'Unknown'}</td>
                        <td className="p-2">{s.activationsCount}</td>
                        <td className="p-2 font-bold text-purple-600">{s.totalCoinsSpent}</td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="text-center py-8 text-gray-500">No statistics available</div>
          )}
        </div>
      </main>
    </div>
  );
}

