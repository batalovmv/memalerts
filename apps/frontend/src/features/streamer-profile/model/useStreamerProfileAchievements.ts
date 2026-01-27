import { GetChannelAchievementsResponseSchema, type AchievementSnapshot } from '@memalerts/api-contracts';
import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from '@/lib/api';

export function useStreamerProfileAchievements(params: { slug: string | undefined; isAuthed: boolean }) {
  const { slug, isAuthed } = params;
  const [achievements, setAchievements] = useState<AchievementSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadingRef = useRef(false);
  const blockedRef = useRef(false);

  const loadAchievements = useCallback(async () => {
    if (!slug || !isAuthed) return;
    if (loadingRef.current || blockedRef.current) return;
    try {
      loadingRef.current = true;
      setLoading(true);
      setError(null);
      const raw = await api.get<unknown>(`/channels/${slug}/achievements/me`, { timeout: 12000 });
      const parsed = GetChannelAchievementsResponseSchema.parse(raw);
      setAchievements(parsed);
    } catch (err) {
      const apiError = err as { response?: { status?: number; data?: { error?: string } } };
      const status = apiError.response?.status;
      if (status === 401 || status === 403) {
        blockedRef.current = true;
      }
      setError(apiError.response?.data?.error || 'Failed to load achievements');
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [isAuthed, slug]);

  useEffect(() => {
    if (!isAuthed) {
      blockedRef.current = false;
      setAchievements(null);
      setError(null);
      setLoading(false);
      return;
    }
    blockedRef.current = false;
    void loadAchievements();
  }, [isAuthed, loadAchievements]);

  return {
    achievements,
    loading,
    error,
    reload: loadAchievements,
  };
}
