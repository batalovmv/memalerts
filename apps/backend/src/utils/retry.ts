import { recordRetryAttempt, recordRetryOutcome } from './metrics.js';

export type RetryOutcome = 'success' | 'failure';

export type RetryOptions<T> = {
  service: string;
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  factor?: number;
  jitter?: 'full' | 'none';
  retryOnError?: (error: unknown) => boolean;
  retryOnResult?: (result: T) => boolean;
  isSuccessResult?: (result: T) => boolean;
  onRetry?: (info: { attempt: number; nextDelayMs: number; error?: unknown; result?: T }) => void;
};

function clampInt(n: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return Math.floor(n);
}

export function getServiceRetryConfig(
  service: string,
  defaults: { maxAttempts: number; baseDelayMs: number; maxDelayMs: number; factor?: number; jitter?: 'full' | 'none' }
): { maxAttempts: number; baseDelayMs: number; maxDelayMs: number; factor: number; jitter: 'full' | 'none' } {
  const upper = service.toUpperCase();
  const maxAttempts = clampInt(
    parseInt(String(process.env[`${upper}_RETRY_MAX_ATTEMPTS`] || ''), 10),
    1,
    10,
    defaults.maxAttempts
  );
  const baseDelayMs = clampInt(
    parseInt(String(process.env[`${upper}_RETRY_BASE_DELAY_MS`] || ''), 10),
    50,
    30_000,
    defaults.baseDelayMs
  );
  const maxDelayMs = clampInt(
    parseInt(String(process.env[`${upper}_RETRY_MAX_DELAY_MS`] || ''), 10),
    baseDelayMs,
    120_000,
    defaults.maxDelayMs
  );
  const factor = Number.isFinite(defaults.factor) ? defaults.factor! : 2;
  const jitter = defaults.jitter || 'full';
  return { maxAttempts, baseDelayMs, maxDelayMs, factor, jitter };
}

function computeDelayMs(
  opts: { baseDelayMs: number; maxDelayMs: number; factor: number; jitter: 'full' | 'none' },
  retryIndex: number
) {
  const raw = opts.baseDelayMs * Math.pow(opts.factor, Math.max(0, retryIndex - 1));
  const capped = Math.min(opts.maxDelayMs, Math.max(0, raw));
  if (opts.jitter === 'full') {
    return Math.floor(Math.random() * capped);
  }
  return Math.floor(capped);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withRetry<T>(action: (attempt: number) => Promise<T>, options: RetryOptions<T>): Promise<T> {
  const retryOnError = options.retryOnError ?? (() => true);
  const factor = Number.isFinite(options.factor) ? options.factor! : 2;
  const jitter = options.jitter || 'full';
  let attempt = 1;

  while (true) {
    try {
      const result = await action(attempt);
      const shouldRetry = options.retryOnResult ? options.retryOnResult(result) : false;
      if (shouldRetry && attempt < options.maxAttempts) {
        const delayMs = computeDelayMs(
          { baseDelayMs: options.baseDelayMs, maxDelayMs: options.maxDelayMs, factor, jitter },
          attempt
        );
        recordRetryAttempt(options.service);
        options.onRetry?.({ attempt, nextDelayMs: delayMs, result });
        await sleep(delayMs);
        attempt += 1;
        continue;
      }
      const success = options.isSuccessResult && options.retryOnResult ? options.isSuccessResult(result) : true;
      recordRetryOutcome({ service: options.service, outcome: success ? 'success' : 'failure' });
      return result;
    } catch (error) {
      const shouldRetry = attempt < options.maxAttempts && retryOnError(error);
      if (!shouldRetry) {
        recordRetryOutcome({ service: options.service, outcome: 'failure' });
        throw error;
      }
      const delayMs = computeDelayMs(
        { baseDelayMs: options.baseDelayMs, maxDelayMs: options.maxDelayMs, factor, jitter },
        attempt
      );
      recordRetryAttempt(options.service);
      options.onRetry?.({ attempt, nextDelayMs: delayMs, error });
      await sleep(delayMs);
      attempt += 1;
    }
  }
}
