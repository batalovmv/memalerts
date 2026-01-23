import { apiGetWithMeta } from '@/lib/api';

export type OwnerAiProcessingItem = {
  stuck: boolean;
  channelSlug?: string | null;
  fileHash?: string | null;
  aiLastTriedAt?: string | null;
  error?: string | null;
  _raw?: unknown;
};

export type OwnerAiStatusResponse = {
  /**
   * Best-effort extraction of numeric counters returned by backend.
   * Backend remains source of truth; unknown keys are preserved here.
   */
  counters: Record<string, number>;
  processing: {
    items: OwnerAiProcessingItem[];
  };
  _raw?: unknown;
};

export type OwnerAiStatusQuery = {
  take?: number;
};

function qs(query: OwnerAiStatusQuery): string {
  const p = new URLSearchParams();
  if (typeof query.take === 'number' && Number.isFinite(query.take) && query.take > 0) p.set('take', String(query.take));
  const s = p.toString();
  return s ? `?${s}` : '';
}

function asObj(x: unknown): Record<string, unknown> | null {
  return x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : null;
}

function getOptionalString(x: unknown): string | null {
  return typeof x === 'string' ? x : x === null ? null : null;
}

function extractCounters(obj: Record<string, unknown> | null): Record<string, number> {
  if (!obj) return {};

  const counters: Record<string, number> = {};

  // 1) Top-level numeric fields (excluding "processing").
  for (const [k, v] of Object.entries(obj)) {
    if (k === 'processing') continue;
    if (typeof v === 'number' && Number.isFinite(v)) counters[k] = v;
  }

  // 2) Common nested containers (best-effort).
  const nested = asObj(obj.counters) ?? asObj(obj.counts) ?? asObj(obj.stats);
  if (nested) {
    for (const [k, v] of Object.entries(nested)) {
      if (typeof v === 'number' && Number.isFinite(v)) counters[k] = v;
    }
  }

  return counters;
}

export async function getOwnerAiStatus(query: OwnerAiStatusQuery = {}): Promise<OwnerAiStatusResponse> {
  const { data: res } = await apiGetWithMeta<unknown>(`/owner/ai/status${qs(query)}`);
  const obj = asObj(res);

  const processingObj = asObj(obj?.processing);
  const itemsRaw = (processingObj?.items as unknown) ?? [];
  const itemsArr = Array.isArray(itemsRaw) ? itemsRaw : [];

  const items: OwnerAiProcessingItem[] = itemsArr.map((x) => {
    const r = asObj(x);
    return {
      stuck: r?.stuck === true,
      channelSlug: getOptionalString(r?.channelSlug),
      fileHash: getOptionalString(r?.fileHash),
      aiLastTriedAt: getOptionalString(r?.aiLastTriedAt),
      error: getOptionalString(r?.error) ?? getOptionalString(r?.shortError) ?? getOptionalString(r?.aiError),
      _raw: x,
    };
  });

  return {
    counters: extractCounters(obj),
    processing: { items },
    _raw: res,
  };
}


