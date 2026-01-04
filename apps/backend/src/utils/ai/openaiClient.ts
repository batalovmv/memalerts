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

export async function openaiFetchJson<T>(
  path: string,
  init: RequestInit,
  opts: OpenAIClientOpts
): Promise<T> {
  const base = getOpenAIBaseUrl();
  const timeoutMs = getOpenAIHttpTimeoutMs();
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(new Error('openai_timeout')), timeoutMs);

  // If caller provides a signal, merge it with our timeout signal (best-effort).
  // Node 20 supports AbortSignal.any, but keep a fallback for safety.
  const mergedSignal: AbortSignal | undefined = (() => {
    const external = (init as any)?.signal as AbortSignal | undefined;
    if (!external) return ac.signal;
    try {
      // eslint-disable-next-line no-undef
      return (AbortSignal as any).any([external, ac.signal]) as AbortSignal;
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
  } catch (e: any) {
    const msg = String(e?.message || e || '');
    if (msg.includes('openai_timeout')) throw new Error(`openai_timeout_${timeoutMs}`);
    if (msg.toLowerCase().includes('abort')) throw new Error(`openai_aborted_${timeoutMs}`);
    throw e;
  } finally {
    clearTimeout(t);
  }

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`openai_http_${res.status}:${txt || res.statusText}`);
  }

  return (await res.json()) as T;
}


