import { GetLatestStreamRecapResponseSchema, type StreamRecap, type User } from '@memalerts/api-contracts';
import { useCallback, useEffect, useState } from 'react';

import { api } from '@/lib/api';

type UseStreamRecapOptions = {
  user: User | null | undefined;
};

export function useStreamRecap({ user }: UseStreamRecapOptions) {
  const [recap, setRecap] = useState<StreamRecap | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadRecap = useCallback(async () => {
    if (!user?.channelId) return;
    if (loading) return;
    try {
      setLoading(true);
      setError(null);
      const raw = await api.get<unknown>('/streamer/stream-recap/latest', { timeout: 15000 });
      const parsed = GetLatestStreamRecapResponseSchema.parse(raw);
      setRecap(parsed.recap ?? null);
    } catch (err) {
      const apiError = err as { response?: { data?: { error?: string } } };
      setError(apiError.response?.data?.error || 'Failed to load recap');
    } finally {
      setLoading(false);
    }
  }, [loading, user?.channelId]);

  useEffect(() => {
    if (!user) return;
    if (user.role !== 'streamer' && user.role !== 'admin') return;
    void loadRecap();
  }, [loadRecap, user]);

  return {
    recap,
    loading,
    error,
    reload: loadRecap,
  };
}
