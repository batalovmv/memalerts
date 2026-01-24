import { useEffect, useState } from 'react';

import { subscribeNow } from '@/shared/lib/timeTicker';

export function useSharedNow(opts?: { enabled?: boolean; untilMs?: number | null }) {
  const [now, setNow] = useState(() => Date.now());
  const enabled = opts?.enabled ?? true;

  useEffect(() => {
    if (!enabled) return;
    return subscribeNow(setNow, { untilMs: opts?.untilMs ?? null });
  }, [enabled, opts?.untilMs]);

  return now;
}
