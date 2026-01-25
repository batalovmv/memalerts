import { useEffect, useState } from 'react';

import { api } from '@/lib/api';

export type LeaderboardPeriodDays = 7 | 30;

export type MemeStatsEntry = {
  meme: {
    id: string;
    title: string;
    priceCoins?: number;
    tags?: Array<{ tag: { id: string; name: string } }>;
  } | null;
  activationsCount: number;
  totalCoinsSpent: number;
};

type MemeStatsResponse = {
  stats: MemeStatsEntry[];
  period: string;
  startDate: string;
  endDate: string;
};

const mapPeriod = (days: LeaderboardPeriodDays): string => (days === 7 ? 'week' : 'month');

export function useStreamerProfileLeaderboard(params: {
  channelSlug: string;
  periodDays: LeaderboardPeriodDays;
  limit?: number;
  enabled?: boolean;
}) {
  const { channelSlug, periodDays, limit = 5, enabled = true } = params;
  const [stats, setStats] = useState<MemeStatsEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const slug = channelSlug.trim();
    if (!enabled || !slug) return;

    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const qs = new URLSearchParams();
        qs.set('period', mapPeriod(periodDays));
        qs.set('limit', String(limit));
        const data = await api.get<MemeStatsResponse>(
          `/channels/${encodeURIComponent(slug)}/leaderboard?${qs.toString()}`
        );
        if (!cancelled) {
          setStats(Array.isArray(data?.stats) ? data.stats : []);
        }
      } catch {
        if (!cancelled) {
          setStats([]);
          setError('failed');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [channelSlug, enabled, limit, periodDays]);

  return { stats, loading, error };
}
