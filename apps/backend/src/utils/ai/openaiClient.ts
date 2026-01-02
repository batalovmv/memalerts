type OpenAIClientOpts = {
  apiKey: string;
};

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
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      ...(init.headers || {}),
    },
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`openai_http_${res.status}:${txt || res.statusText}`);
  }

  return (await res.json()) as T;
}


