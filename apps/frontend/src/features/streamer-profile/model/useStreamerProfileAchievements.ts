import { GetChannelAchievementsResponseSchema, type AchievementSnapshot } from '@memalerts/api-contracts';
import { useCallback, useEffect, useState } from 'react';

import { api } from '@/lib/api';

export function useStreamerProfileAchievements(params: { slug: string | undefined; isAuthed: boolean }) {
  const { slug, isAuthed } = params;
  const [achievements, setAchievements] = useState<AchievementSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadAchievements = useCallback(async () => {
    if (!slug || !isAuthed) return;
    if (loading) return;
    try {
      setLoading(true);
      setError(null);
      const raw = await api.get<unknown>(`/channels/${slug}/achievements/me`, { timeout: 12000 });
      const parsed = GetChannelAchievementsResponseSchema.parse(raw);
      setAchievements(parsed);
    } catch (err) {
      const apiError = err as { response?: { data?: { error?: string } } };
      setError(apiError.response?.data?.error || 'Failed to load achievements');
    } finally {
      setLoading(false);
    }
  }, [isAuthed, loading, slug]);

  useEffect(() => {
    void loadAchievements();
  }, [loadAchievements]);

  return {
    achievements,
    loading,
    error,
    reload: loadAchievements,
  };
}
