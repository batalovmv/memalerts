import { recordHttpClientTimeout } from './metrics.js';
import { isTimeoutError } from './httpErrors.js';

function clampInt(n: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return Math.floor(n);
}

export function getServiceHttpTimeoutMs(
  service: string,
  fallbackMs: number,
  minMs = 1000,
  maxMs = 120_000
): number {
  const key = `${service.toUpperCase()}_HTTP_TIMEOUT_MS`;
  const raw = parseInt(String(process.env[key] || ''), 10);
  return clampInt(raw, minMs, maxMs, fallbackMs);
}

export function createTimeoutSignal(
  timeoutMs: number,
  reason = 'http_timeout'
): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error(reason)), timeoutMs);
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timeout),
  };
}

export async function fetchWithTimeout(params: {
  url: string;
  init?: RequestInit;
  service: string;
  timeoutMs: number;
  timeoutReason?: string;
}): Promise<Response> {
  const { signal, clear } = createTimeoutSignal(params.timeoutMs, params.timeoutReason);
  try {
    return await fetch(params.url, { ...params.init, signal });
  } catch (error) {
    if (isTimeoutError(error)) {
      recordHttpClientTimeout({ service: params.service, timeoutMs: params.timeoutMs });
    }
    throw error;
  } finally {
    clear();
  }
}
