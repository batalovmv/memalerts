import { apiGetWithMeta, apiRequestWithMeta } from '@/lib/api';

export type OwnerMemeAssetStatus = 'hidden' | 'quarantine' | 'purged' | 'all';

export type OwnerMemeAssetsQuery = {
  status?: OwnerMemeAssetStatus;
  q?: string;
  limit?: number;
  offset?: number;
};

export type OwnerMemeAsset = {
  id: string;
  type?: 'image' | 'gif' | 'video' | 'audio' | string;
  fileUrl?: string | null;
  durationMs?: number | null;
  fileHash?: string | null;

  poolVisibility?: 'visible' | 'hidden' | string | null;
  purgeRequestedAt?: string | null;
  purgeNotBefore?: string | null;
  purgedAt?: string | null;

  purgeReason?: string | null;
  hiddenReason?: string | null;

  _raw?: unknown;
};

export type OwnerMemeAssetsResponse = {
  items: OwnerMemeAsset[];
  total?: number;
  limit?: number;
  offset?: number;
};

function qs(query: OwnerMemeAssetsQuery): string {
  const p = new URLSearchParams();
  if (query.status) p.set('status', query.status);
  if (query.q && query.q.trim()) p.set('q', query.q.trim());
  if (typeof query.limit === 'number') p.set('limit', String(query.limit));
  if (typeof query.offset === 'number') p.set('offset', String(query.offset));
  const s = p.toString();
  return s ? `?${s}` : '';
}

export async function getOwnerMemeAssets(query: OwnerMemeAssetsQuery = {}): Promise<OwnerMemeAssetsResponse> {
  const { data: res, meta } = await apiGetWithMeta<unknown>(`/owner/meme-assets${qs(query)}`);
  const obj = res && typeof res === 'object' && !Array.isArray(res) ? (res as Record<string, unknown>) : null;
  // Backend may return either:
  // - Array<DTO> (current backend)
  // - { items, total, limit, offset } (future/back-compat)
  const itemsRaw = Array.isArray(res) ? res : ((obj?.items as unknown) ?? []);
  const items = (Array.isArray(itemsRaw) ? itemsRaw : []).map((x) => {
    const r = x && typeof x === 'object' ? (x as Record<string, unknown>) : null;
    const id = typeof r?.id === 'string' ? r.id : '';
    return {
      id,
      type: typeof r?.type === 'string' ? (r.type as OwnerMemeAsset['type']) : undefined,
      fileUrl: typeof r?.fileUrl === 'string' ? (r.fileUrl as string) : r?.fileUrl === null ? null : undefined,
      durationMs: typeof r?.durationMs === 'number' ? (r.durationMs as number) : r?.durationMs === null ? null : undefined,
      fileHash: typeof r?.fileHash === 'string' ? (r.fileHash as string) : r?.fileHash === null ? null : undefined,
      poolVisibility: typeof r?.poolVisibility === 'string' ? (r.poolVisibility as string) : r?.poolVisibility === null ? null : undefined,
      purgeRequestedAt: typeof r?.purgeRequestedAt === 'string' ? (r.purgeRequestedAt as string) : r?.purgeRequestedAt === null ? null : undefined,
      purgeNotBefore: typeof r?.purgeNotBefore === 'string' ? (r.purgeNotBefore as string) : r?.purgeNotBefore === null ? null : undefined,
      purgedAt: typeof r?.purgedAt === 'string' ? (r.purgedAt as string) : r?.purgedAt === null ? null : undefined,
      purgeReason: typeof r?.purgeReason === 'string' ? (r.purgeReason as string) : r?.purgeReason === null ? null : undefined,
      hiddenReason: typeof r?.hiddenReason === 'string' ? (r.hiddenReason as string) : r?.hiddenReason === null ? null : undefined,
      _raw: x,
    } satisfies OwnerMemeAsset;
  });

  return {
    items,
    total:
      typeof obj?.total === 'number'
        ? (obj.total as number)
        : typeof meta.headers['x-total'] === 'string'
          ? Number(meta.headers['x-total'])
          : typeof meta.headers['x-total'] === 'number'
            ? (meta.headers['x-total'] as number)
            : undefined,
    limit:
      typeof obj?.limit === 'number'
        ? (obj.limit as number)
        : typeof meta.headers['x-limit'] === 'string'
          ? Number(meta.headers['x-limit'])
          : typeof meta.headers['x-limit'] === 'number'
            ? (meta.headers['x-limit'] as number)
            : undefined,
    offset:
      typeof obj?.offset === 'number'
        ? (obj.offset as number)
        : typeof meta.headers['x-offset'] === 'string'
          ? Number(meta.headers['x-offset'])
          : typeof meta.headers['x-offset'] === 'number'
            ? (meta.headers['x-offset'] as number)
            : undefined,
  };
}

export async function ownerRestoreMemeAsset(id: string): Promise<void> {
  // Response body is irrelevant; we only need status.
  await apiRequestWithMeta({ method: 'POST', url: `/owner/meme-assets/${encodeURIComponent(id)}/restore`, data: {} });
}


