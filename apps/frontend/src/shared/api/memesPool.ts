import type { Meme } from '@/types';

import { api } from '@/lib/api';

export type MemesPoolQuery = {
  limit?: number;
  offset?: number;
  q?: string;
};

/**
 * Global meme pool (beta-gated on backend).
 * GET /memes/pool?limit=&offset=&q=
 */
export async function getMemesPool(query: MemesPoolQuery = {}): Promise<Meme[]> {
  const params = new URLSearchParams();
  if (typeof query.limit === 'number') params.set('limit', String(query.limit));
  if (typeof query.offset === 'number') params.set('offset', String(query.offset));
  if (typeof query.q === 'string' && query.q.trim()) params.set('q', query.q.trim());

  const qs = params.toString();
  return await api.get<Meme[]>(`/memes/pool${qs ? `?${qs}` : ''}`);
}


