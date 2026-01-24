type NowListener = (now: number) => void;

const listeners = new Map<NowListener, { untilMs?: number | null }>();
let timerId: number | null = null;

function ensureTimer() {
  if (timerId !== null) return;
  timerId = window.setInterval(() => {
    const now = Date.now();
    for (const [listener, opts] of listeners.entries()) {
      listener(now);
      if (opts.untilMs && now >= opts.untilMs) {
        listeners.delete(listener);
      }
    }
    if (listeners.size === 0 && timerId !== null) {
      window.clearInterval(timerId);
      timerId = null;
    }
  }, 500);
}

export function subscribeNow(listener: NowListener, opts?: { untilMs?: number | null }): () => void {
  listeners.set(listener, { untilMs: opts?.untilMs });
  ensureTimer();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timerId !== null) {
      window.clearInterval(timerId);
      timerId = null;
    }
  };
}
