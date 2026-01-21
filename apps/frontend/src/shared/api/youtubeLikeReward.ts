import { api } from './httpClient';

import { getApiOriginForRedirect } from '@/shared/auth/login';

export type YouTubeLikeClaimStatus =
  | 'disabled'
  | 'need_youtube_link'
  | 'need_relink_scopes'
  | 'not_live'
  | 'cooldown'
  | 'not_liked'
  | 'already_awarded'
  | 'awarded'
  | 'failed';

export type YouTubeLikeClaimResponse = {
  status: YouTubeLikeClaimStatus;
  videoId?: string;
  coinsGranted?: number;
  balance?: number;
  rating?: unknown;
  requiredScopes?: string[];
  accountScopes?: string[];
};

export type YouTubeLikeClaimBody = { channelSlug: string; videoId?: string };

export async function claimYouTubeLike(body: YouTubeLikeClaimBody): Promise<YouTubeLikeClaimResponse> {
  return await api.post<YouTubeLikeClaimResponse>('/rewards/youtube/like/claim', body);
}

export function getYouTubeForceSslLinkUrl(params: { redirectTo: string; origin?: string }): string {
  const apiOrigin = getApiOriginForRedirect();
  const url = new URL(`${apiOrigin}/auth/youtube/link/force-ssl`);
  url.searchParams.set('redirect_to', params.redirectTo);
  url.searchParams.set('origin', params.origin ?? window.location.origin);
  return url.toString();
}


