import type { MemePoolItem } from './memesPool';

import { api } from '@/lib/api';

export type StarterMemesQuery = {
  limit?: number;
};

/**
 * Fetch curated starter memes for the streamer's channel.
 * GET /streamer/starter-memes
 */
export async function getStarterMemes(query: StarterMemesQuery = {}): Promise<MemePoolItem[]> {
  const params = new URLSearchParams();
  if (typeof query.limit === 'number') params.set('limit', String(query.limit));
  const qs = params.toString();
  return await api.get<MemePoolItem[]>(`/streamer/starter-memes${qs ? `?${qs}` : ''}`);
}
