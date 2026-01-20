type BackoffOptions = {
  baseMs: number;
  maxMs: number;
  factor: number;
  jitter: number;
};

const DEFAULT_OPTIONS: BackoffOptions = {
  baseMs: 5000,
  maxMs: 60_000,
  factor: 2,
  jitter: 0.25,
};

export function createReconnectBackoff(options: Partial<BackoffOptions> = {}) {
  const opts: BackoffOptions = { ...DEFAULT_OPTIONS, ...options };
  let attempts = 0;

  const nextDelayMs = () => {
    attempts += 1;
    const base = opts.baseMs * Math.pow(opts.factor, Math.max(0, attempts - 1));
    const capped = Math.min(opts.maxMs, base);
    const jitterRange = capped * opts.jitter;
    const jitter = jitterRange > 0 ? (Math.random() * 2 - 1) * jitterRange : 0;
    return Math.max(250, Math.round(capped + jitter));
  };

  const reset = () => {
    attempts = 0;
  };

  return { nextDelayMs, reset };
}
