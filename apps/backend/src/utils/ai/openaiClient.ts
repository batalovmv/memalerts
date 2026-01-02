type OpenAIClientOpts = {
  apiKey: string;
};

export function getOpenAIApiKey(): string | null {
  const k = String(process.env.OPENAI_API_KEY || '').trim();
  return k ? k : null;
}

export async function openaiFetchJson<T>(
  path: string,
  init: RequestInit,
  opts: OpenAIClientOpts
): Promise<T> {
  const res = await fetch(`https://api.openai.com${path}`, {
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


