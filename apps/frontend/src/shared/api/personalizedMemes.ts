import type { Meme } from '@/types';

import { api } from '@/lib/api';

export type PersonalizedMemesResponse = {
  items: Meme[];
  profileReady: boolean;
  totalActivations: number;
  mode: 'personalized' | 'fallback';
};

export type PersonalizedMemesQuery = {
  limit?: number;
  candidates?: number;
};

function qs(query: PersonalizedMemesQuery): string {
  const p = new URLSearchParams();
  if (typeof query.limit === 'number' && Number.isFinite(query.limit)) p.set('limit', String(query.limit));
  if (typeof query.candidates === 'number' && Number.isFinite(query.candidates)) p.set('candidates', String(query.candidates));
  const s = p.toString();
  return s ? `?${s}` : '';
}

export async function getPersonalizedMemes(
  channelSlug: string,
  query: PersonalizedMemesQuery = {}
): Promise<PersonalizedMemesResponse> {
  const slug = String(channelSlug || '').trim();
  return await api.get<PersonalizedMemesResponse>(`/channels/${encodeURIComponent(slug)}/memes/personalized${qs(query)}`, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
