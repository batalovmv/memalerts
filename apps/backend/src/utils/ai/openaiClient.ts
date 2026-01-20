import { getCircuitBreaker } from '../circuitBreaker.js';
import { isTimeoutError, isTransientHttpError } from '../httpErrors.js';
import { recordHttpClientTimeout } from '../metrics.js';

type OpenAIClientOpts = {
  apiKey: string;
};

function clampInt(n: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return Math.floor(n);
}

function getOpenAIHttpTimeoutMs(): number {
  const raw = parseInt(String(process.env.OPENAI_HTTP_TIMEOUT_MS || ''), 10);
  // Default: 60s (ASR can take longer for certain clips / congestion).
  return clampInt(raw, 1_000, 10 * 60_000, 60_000);
}

export function getOpenAIApiKey(): string | null {
  const k = String(process.env.OPENAI_API_KEY || '').trim();
  return k ? k : null;
}

function getOpenAIBaseUrl(): string {
  // Allow routing through a gateway/proxy (e.g. a region-allowed egress) without code changes.
  // Examples:
  // - OPENAI_BASE_URL=https://api.openai.com
  // - OPENAI_API_BASE_URL=https://your-gateway.example.com
  const raw = String(process.env.OPENAI_BASE_URL || process.env.OPENAI_API_BASE_URL || '').trim();
  if (!raw) return 'https://api.openai.com';
  return raw.replace(/\/+$/, '');
}

export async function openaiFetchJson<T>(path: string, init: RequestInit, opts: OpenAIClientOpts): Promise<T> {
  const circuit = getCircuitBreaker('openai');
  return circuit.execute(
    async () => {
      const base = getOpenAIBaseUrl();
      const timeoutMs = getOpenAIHttpTimeoutMs();
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(new Error('openai_timeout')), timeoutMs);

      // If caller provides a signal, merge it with our timeout signal (best-effort).
      // Node 20 supports AbortSignal.any, but keep a fallback for safety.
      const mergedSignal: AbortSignal | undefined = (() => {
        const external = (init as { signal?: AbortSignal })?.signal;
        if (!external) return ac.signal;
        try {
          const signalAny = (
            AbortSignal as typeof AbortSignal & {
              any?: (signals: AbortSignal[]) => AbortSignal;
            }
          ).any;
          if (typeof signalAny === 'function') {
            return signalAny([external, ac.signal]);
          }
          return external;
        } catch {
          // Fallback: prefer external, but it means our timeout won't abort fetch in older runtimes.
          return external;
        }
      })();

      let res: Response;
      try {
        res = await fetch(`${base}${path}`, {
          ...init,
          signal: mergedSignal,
          headers: {
            Authorization: `Bearer ${opts.apiKey}`,
            ...(init.headers || {}),
          },
        });
      } catch (error) {
        if (isTimeoutError(error)) {
          recordHttpClientTimeout({ service: 'openai', timeoutMs });
          const err = new Error(`openai_timeout_${timeoutMs}`) as Error & { code?: string };
          err.code = 'OPENAI_TIMEOUT';
          throw err;
        }
        const err = error as { message?: string };
        const msg = String(err?.message || error || '');
        if (msg.toLowerCase().includes('abort')) {
          const abortErr = new Error(`openai_aborted_${timeoutMs}`) as Error & { code?: string };
          abortErr.code = 'OPENAI_ABORTED';
          throw abortErr;
        }
        throw error;
      } finally {
        clearTimeout(t);
      }

      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        const err = new Error(`openai_http_${res.status}:${txt || res.statusText}`) as Error & {
          status?: number;
          body?: string;
        };
        err.status = res.status;
        err.body = txt || undefined;
        throw err;
      }

      return (await res.json()) as T;
    },
    { isFailure: isTransientHttpError }
  );
}
