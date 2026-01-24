import { apiGetWithMeta, apiRequestWithMeta } from '@/lib/api';

export type OwnerTagSuggestionStatus = 'pending' | 'approved' | 'rejected' | 'mapped' | 'all';
export type OwnerTagStatus = 'active' | 'pending' | 'deprecated' | 'all';

export type OwnerTagSuggestion = {
  id: string;
  rawTag?: string;
  normalizedTag?: string;
  count?: number;
  status?: OwnerTagSuggestionStatus;
  mappedToTagId?: string | null;
  createdAt?: string;
  reviewedAt?: string | null;
  mappedTo?: { id: string; name: string; displayName?: string | null } | null;
  memeAsset?: { id: string; aiAutoTitle?: string | null; fileUrl?: string | null } | null;
  _raw?: unknown;
};

export type OwnerTagCategory = {
  id: string;
  slug: string;
  displayName: string;
  sortOrder?: number;
};

export type OwnerTag = {
  id: string;
  name: string;
  displayName?: string | null;
  status?: OwnerTagStatus;
  usageCount?: number;
  category?: { id: string; slug: string; displayName: string } | null;
  _raw?: unknown;
};

export type OwnerTagSuggestionsQuery = {
  status?: OwnerTagSuggestionStatus;
  q?: string;
  limit?: number;
  offset?: number;
};

export type OwnerTagsQuery = {
  status?: OwnerTagStatus;
  q?: string;
  limit?: number;
  offset?: number;
};

export type OwnerTagSuggestionsResponse = {
  items: OwnerTagSuggestion[];
  total?: number;
  limit?: number;
  offset?: number;
};

export type OwnerTagsResponse = {
  items: OwnerTag[];
  total?: number;
  limit?: number;
  offset?: number;
};

function qs(query: Record<string, unknown>): string {
  const p = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    const val = typeof value === 'string' ? value.trim() : value;
    if (typeof val === 'string' && !val) continue;
    p.set(key, String(val));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

function asObj(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function getMetaNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const num = Number(value);
    if (Number.isFinite(num)) return num;
  }
  return undefined;
}

export async function getOwnerTagSuggestions(query: OwnerTagSuggestionsQuery = {}): Promise<OwnerTagSuggestionsResponse> {
  const { data: res, meta } = await apiGetWithMeta<unknown>(`/owner/tag-suggestions${qs(query)}`);
  const obj = asObj(res);
  const itemsRaw = Array.isArray(res) ? res : ((obj?.items as unknown) ?? []);
  const items = (Array.isArray(itemsRaw) ? itemsRaw : []).map((x) => {
    const r = asObj(x);
    return {
      id: typeof r?.id === 'string' ? r.id : '',
      rawTag: typeof r?.rawTag === 'string' ? r.rawTag : undefined,
      normalizedTag: typeof r?.normalizedTag === 'string' ? r.normalizedTag : undefined,
      count: typeof r?.count === 'number' ? r.count : undefined,
      status: typeof r?.status === 'string' ? (r.status as OwnerTagSuggestionStatus) : undefined,
      mappedToTagId: typeof r?.mappedToTagId === 'string' ? r.mappedToTagId : r?.mappedToTagId === null ? null : undefined,
      createdAt: typeof r?.createdAt === 'string' ? r.createdAt : undefined,
      reviewedAt: typeof r?.reviewedAt === 'string' ? r.reviewedAt : r?.reviewedAt === null ? null : undefined,
      mappedTo: r?.mappedTo
        ? {
            id: typeof (r.mappedTo as Record<string, unknown>).id === 'string' ? (r.mappedTo as Record<string, unknown>).id : '',
            name:
              typeof (r.mappedTo as Record<string, unknown>).name === 'string'
                ? (r.mappedTo as Record<string, unknown>).name
                : '',
            displayName:
              typeof (r.mappedTo as Record<string, unknown>).displayName === 'string'
                ? (r.mappedTo as Record<string, unknown>).displayName
                : (r.mappedTo as Record<string, unknown>).displayName === null
                  ? null
                  : undefined,
          }
        : undefined,
      memeAsset: r?.memeAsset
        ? {
            id: typeof (r.memeAsset as Record<string, unknown>).id === 'string' ? (r.memeAsset as Record<string, unknown>).id : '',
            aiAutoTitle:
              typeof (r.memeAsset as Record<string, unknown>).aiAutoTitle === 'string'
                ? (r.memeAsset as Record<string, unknown>).aiAutoTitle
                : (r.memeAsset as Record<string, unknown>).aiAutoTitle === null
                  ? null
                  : undefined,
            fileUrl:
              typeof (r.memeAsset as Record<string, unknown>).fileUrl === 'string'
                ? (r.memeAsset as Record<string, unknown>).fileUrl
                : (r.memeAsset as Record<string, unknown>).fileUrl === null
                  ? null
                  : undefined,
          }
        : undefined,
      _raw: x,
    } satisfies OwnerTagSuggestion;
  });

  return {
    items,
    total: getMetaNumber(obj?.total ?? meta.headers['x-total']),
    limit: getMetaNumber(obj?.limit ?? meta.headers['x-limit']),
    offset: getMetaNumber(obj?.offset ?? meta.headers['x-offset']),
  };
}

export async function getOwnerTags(query: OwnerTagsQuery = {}): Promise<OwnerTagsResponse> {
  const { data: res, meta } = await apiGetWithMeta<unknown>(`/owner/tags${qs(query)}`);
  const obj = asObj(res);
  const itemsRaw = Array.isArray(res) ? res : ((obj?.items as unknown) ?? []);
  const items = (Array.isArray(itemsRaw) ? itemsRaw : []).map((x) => {
    const r = asObj(x);
    return {
      id: typeof r?.id === 'string' ? r.id : '',
      name: typeof r?.name === 'string' ? r.name : '',
      displayName: typeof r?.displayName === 'string' ? r.displayName : r?.displayName === null ? null : undefined,
      status: typeof r?.status === 'string' ? (r.status as OwnerTagStatus) : undefined,
      usageCount: typeof r?.usageCount === 'number' ? r.usageCount : undefined,
      category: r?.category
        ? {
            id: typeof (r.category as Record<string, unknown>).id === 'string' ? (r.category as Record<string, unknown>).id : '',
            slug: typeof (r.category as Record<string, unknown>).slug === 'string' ? (r.category as Record<string, unknown>).slug : '',
            displayName:
              typeof (r.category as Record<string, unknown>).displayName === 'string'
                ? (r.category as Record<string, unknown>).displayName
                : '',
          }
        : undefined,
      _raw: x,
    } satisfies OwnerTag;
  });

  return {
    items,
    total: getMetaNumber(obj?.total ?? meta.headers['x-total']),
    limit: getMetaNumber(obj?.limit ?? meta.headers['x-limit']),
    offset: getMetaNumber(obj?.offset ?? meta.headers['x-offset']),
  };
}

export async function getOwnerTagCategories(): Promise<OwnerTagCategory[]> {
  const { data: res } = await apiGetWithMeta<unknown>('/owner/tag-categories');
  const itemsRaw = Array.isArray(res) ? res : [];
  return (Array.isArray(itemsRaw) ? itemsRaw : []).map((x) => {
    const r = asObj(x);
    return {
      id: typeof r?.id === 'string' ? r.id : '',
      slug: typeof r?.slug === 'string' ? r.slug : '',
      displayName: typeof r?.displayName === 'string' ? r.displayName : '',
      sortOrder: typeof r?.sortOrder === 'number' ? r.sortOrder : undefined,
    } satisfies OwnerTagCategory;
  });
}

export async function approveTagSuggestion(id: string, payload: { name?: string; displayName?: string; categoryId?: string | null; categorySlug?: string | null }): Promise<void> {
  await apiRequestWithMeta({ method: 'POST', url: `/owner/tag-suggestions/${encodeURIComponent(id)}/approve`, data: payload });
}

export async function mapTagSuggestion(id: string, payload: { tagId?: string; tagName?: string }): Promise<void> {
  await apiRequestWithMeta({ method: 'POST', url: `/owner/tag-suggestions/${encodeURIComponent(id)}/map`, data: payload });
}

export async function rejectTagSuggestion(id: string): Promise<void> {
  await apiRequestWithMeta({ method: 'POST', url: `/owner/tag-suggestions/${encodeURIComponent(id)}/reject`, data: {} });
}
