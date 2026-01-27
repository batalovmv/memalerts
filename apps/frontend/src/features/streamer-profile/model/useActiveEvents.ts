import { useCallback, useEffect, useState } from 'react';

import { GetActiveEventsResponseSchema, type Event } from '@memalerts/api-contracts';

import { api } from '@/lib/api';

export function useActiveEvents() {
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadEvents = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const raw = await api.get<unknown>('/public/events/active', { timeout: 12000 });
      const parsed = GetActiveEventsResponseSchema.parse(raw);
      setEvents(parsed.events ?? []);
    } catch (err) {
      const apiError = err as { response?: { data?: { error?: string } } };
      setError(apiError.response?.data?.error || 'Failed to load events');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  return {
    events,
    loading,
    error,
    reload: loadEvents,
  };
}
