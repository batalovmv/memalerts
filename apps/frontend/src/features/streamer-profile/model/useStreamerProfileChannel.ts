import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import type { ChannelInfo } from '@/features/streamer-profile/model/types';

import { looksLikeSpaHtml, normalizeChannelInfo } from '@/features/streamer-profile/model/utils';
import { api } from '@/lib/api';

export type ChannelLoadError = null | 'auth_required' | 'forbidden' | 'beta_required' | 'not_found' | 'failed';

type UseStreamerProfileChannelParams = {
  slug?: string | null;
  normalizedSlug: string;
  isAuthed: boolean;
  reloadNonce: number;
};

export function useStreamerProfileChannel({ slug, normalizedSlug, isAuthed, reloadNonce }: UseStreamerProfileChannelParams) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [channelInfo, setChannelInfo] = useState<ChannelInfo | null>(null);
  const [channelLoadError, setChannelLoadError] = useState<ChannelLoadError>(null);
  const [loading, setLoading] = useState(true);
  const lastLoadKeyRef = useRef<string>('');

  useEffect(() => {
    if (!normalizedSlug) {
      navigate('/');
      return;
    }

    // This effect depends on `isAuthed`, so it can re-run when auth hydrates.
    // Avoid reloading the whole page (and refetching memes twice) unless slug or reloadNonce changed.
    const loadKey = `${normalizedSlug}:${reloadNonce}`;
    if (lastLoadKeyRef.current === loadKey) return;
    lastLoadKeyRef.current = loadKey;

    const loadChannelData = async () => {
      // Reset state for a clean retry / slug change.
      setLoading(true);
      setChannelLoadError(null);
      setChannelInfo(null);
      try {
        // Public profile must use public API as canonical source.
        // When unauthenticated, avoid hitting the authed endpoint (it can 401 and also triggers CORS preflights in tests).
        let channelInfoRaw: unknown;
        const channelInfoParams = new URLSearchParams();
        channelInfoParams.set('includeMemes', 'false');
        // Avoid stale cache after recent settings toggles (nginx/CDN/browser).
        channelInfoParams.set('_ts', String(Date.now()));
        const channelInfoUrl = `/channels/${normalizedSlug}?${channelInfoParams.toString()}`;
        const publicChannelInfoUrl = `/public/channels/${normalizedSlug}?${channelInfoParams.toString()}`;
        if (!isAuthed) {
          // Prefer canonical /channels/* (works in prod; /public/* may be served by SPA fallback in some nginx configs).
          try {
            channelInfoRaw = await api.get<unknown>(channelInfoUrl, {
              timeout: 15000,
              headers: { 'Cache-Control': 'no-store' },
            });
          } catch {
            channelInfoRaw = await api.get<unknown>(publicChannelInfoUrl, {
              timeout: 15000,
              headers: { 'Cache-Control': 'no-store' },
            });
            if (looksLikeSpaHtml(channelInfoRaw)) {
              throw new Error('Public channel endpoint returned HTML');
            }
          }
        } else {
          try {
            // Prefer authenticated channel DTO (it includes reward flags like youtubeLikeReward*).
            channelInfoRaw = await api.get<unknown>(channelInfoUrl, {
              timeout: 15000,
              headers: { 'Cache-Control': 'no-store' },
            });
          } catch {
            channelInfoRaw = await api.get<unknown>(publicChannelInfoUrl, {
              timeout: 15000,
              headers: { 'Cache-Control': 'no-store' },
            });
            if (looksLikeSpaHtml(channelInfoRaw)) {
              throw new Error('Public channel endpoint returned HTML');
            }
          }
        }
        const parsed = normalizeChannelInfo(channelInfoRaw, normalizedSlug);
        if (!parsed) {
          throw new Error('Channel info missing');
        }
        setChannelInfo({ ...parsed, memes: [] }); // Set memes to empty array initially
        setLoading(false); // Channel info loaded, can show page structure

        // Canonicalize URL (prevents case-sensitive slug issues on production)
        if (slug && parsed.slug && slug !== parsed.slug) {
          navigate(`/channel/${parsed.slug}`, { replace: true });
        }
      } catch (error: unknown) {
        const apiError = error as { response?: { status?: number; data?: { error?: string; errorCode?: string } } };
        const status = apiError.response?.status;
        const errorCode = apiError.response?.data?.errorCode;
        if (!isAuthed && status === 401) {
          setChannelLoadError('auth_required');
        } else if (status === 403 && errorCode === 'BETA_ACCESS_REQUIRED') {
          setChannelLoadError('beta_required');
        } else if (status === 403) {
          setChannelLoadError('forbidden');
        } else if (status === 404) {
          setChannelLoadError('not_found');
        } else {
          setChannelLoadError('failed');
          toast.error(apiError.response?.data?.error || t('toast.failedToLoadChannel'));
        }
        setLoading(false);
      }
    };

    void loadChannelData();
  }, [isAuthed, navigate, normalizedSlug, reloadNonce, slug, t]);

  return {
    channelInfo,
    setChannelInfo,
    channelLoadError,
    loading,
  };
}
