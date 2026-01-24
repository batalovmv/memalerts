import { useEffect, useState } from 'react';

import { subscribeNow } from '@/shared/lib/timeTicker';

export function useSharedNow(opts?: { enabled?: boolean; untilMs?: number | null }) {
  const [now, setNow] = useState(() => Date.now());
  const enabled = opts?.enabled ?? true;
  const isTest = import.meta.env.MODE === 'test';

  useEffect(() => {
    if (!enabled || isTest) return;
    return subscribeNow(setNow, { untilMs: opts?.untilMs ?? null });
  }, [enabled, isTest, opts?.untilMs]);

  return now;
}
