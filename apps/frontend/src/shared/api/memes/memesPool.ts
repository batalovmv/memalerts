import type { MemeType, MemeVariant } from '@/types';

import { api } from '@/lib/api';

export type MemesPoolQuery = {
  limit?: number;
  offset?: number;
  q?: string;
};

/**
 * Global meme pool item (represents MemeAsset on backend).
 * NOTE: title is channel-specific, so pool returns a sampleTitle (may be null).
 */
export type MemePoolItem = {
  /** memeAssetId */
  id: string;
  memeAssetId?: string | null;

  type?: MemeType;
  fileUrl?: string;
  previewUrl?: string | null;
  variants?: MemeVariant[];
  durationMs?: number;
  tags?: Array<{ tag: { id: string; name: string } }>;
  aiAutoTagNames?: string[] | null;

  sampleTitle?: string | null;
  samplePriceCoins?: number | null;
  usageCount?: number;
};

/**
 * Global meme pool (beta-gated on backend).
 * GET /memes/pool?limit=&offset=&q=
 */
export async function getMemesPool(query: MemesPoolQuery = {}): Promise<MemePoolItem[]> {
  const params = new URLSearchParams();
  if (typeof query.limit === 'number') params.set('limit', String(query.limit));
  if (typeof query.offset === 'number') params.set('offset', String(query.offset));
  if (typeof query.q === 'string' && query.q.trim()) params.set('q', query.q.trim());

  const qs = params.toString();
  return await api.get<MemePoolItem[]>(`/memes/pool${qs ? `?${qs}` : ''}`);
}

