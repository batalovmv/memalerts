import { useCallback, useEffect, useState } from 'react';

import { GetChannelStreamerAchievementsResponseSchema, type AchievementItem } from '@memalerts/api-contracts';

import { api } from '@/lib/api';

export function useStreamerProfileStreamerAchievements(params: { slug: string | undefined }) {
  const { slug } = params;
  const [achievements, setAchievements] = useState<AchievementItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!slug) return;
    if (loading) return;
    try {
      setLoading(true);
      setError(null);
      const raw = await api.get<unknown>(`/channels/${encodeURIComponent(slug)}/achievements/streamer`, { timeout: 12000 });
      const parsed = GetChannelStreamerAchievementsResponseSchema.parse(raw);
      setAchievements(parsed.achievements);
    } catch (err) {
      const apiError = err as { response?: { data?: { error?: string } } };
      setError(apiError.response?.data?.error || 'Failed to load achievements');
    } finally {
      setLoading(false);
    }
  }, [loading, slug]);

  useEffect(() => {
    void load();
  }, [load]);

  return {
    achievements,
    loading,
    error,
    reload: load,
  };
}

