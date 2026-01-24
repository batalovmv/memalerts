import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { BoostyAccessResponse } from '@/features/settings/tabs/rewards/utils';

import { normalizeBoostyAccess } from '@/features/settings/tabs/rewards/utils';
import { toApiError } from '@/shared/api/toApiError';
import { getApiOriginForRedirect } from '@/shared/auth/login';

type UseBoostyAccessParams = {
  effectiveChannelId: string | null;
};

export function useBoostyAccess({ effectiveChannelId }: UseBoostyAccessParams) {
  const { t } = useTranslation();
  const [boostyAccess, setBoostyAccess] = useState<BoostyAccessResponse | null>(null);
  const [boostyAccessLoading, setBoostyAccessLoading] = useState(false);
  const [boostyAccessError, setBoostyAccessError] = useState<string | null>(null);
  const [boostyAccessNeedsAuth, setBoostyAccessNeedsAuth] = useState(false);
  const boostyAccessLoadingRef = useRef(false);

  const refreshBoostyAccess = useCallback(async () => {
    if (!effectiveChannelId) return;
    if (boostyAccessLoadingRef.current) return;
    boostyAccessLoadingRef.current = true;
    setBoostyAccessNeedsAuth(false);
    setBoostyAccessError(null);
    setBoostyAccessLoading(true);
    try {
      const { api } = await import('@/lib/api');
      const raw = await api.get<unknown>(`/channels/${encodeURIComponent(effectiveChannelId)}/boosty-access`, { timeout: 10_000 });
      const parsed = normalizeBoostyAccess(raw);
      if (!parsed) {
        throw new Error('Invalid boosty-access response');
      }
      setBoostyAccess(parsed);
    } catch (e) {
      const err = toApiError(e, t('admin.failedToLoad', { defaultValue: 'Failed to load.' }));
      if (err.statusCode === 401) {
        // Don't auto-redirect to Twitch login: this can cause an OAuth redirect loop
        // when the backend session can't be established for any reason.
        setBoostyAccessNeedsAuth(true);
        setBoostyAccessError(t('auth.authRequired', { defaultValue: 'Please sign in to continue.' }));
      } else {
        setBoostyAccessError(err.message || 'Failed to load.');
      }
    } finally {
      boostyAccessLoadingRef.current = false;
      setBoostyAccessLoading(false);
    }
  }, [effectiveChannelId, t]);

  const redirectToDiscordLink = useCallback(() => {
    const apiOrigin = typeof window !== 'undefined' ? getApiOriginForRedirect() : '';
    if (!apiOrigin) return;
    const url = new URL(`${apiOrigin}/auth/discord/link`);
    url.searchParams.set('origin', window.location.origin);
    url.searchParams.set('redirect_to', '/settings?tab=rewards');
    window.location.href = url.toString();
  }, []);

  useEffect(() => {
    void refreshBoostyAccess();
  }, [refreshBoostyAccess]);

  return {
    boostyAccess,
    boostyAccessLoading,
    boostyAccessError,
    boostyAccessNeedsAuth,
    refreshBoostyAccess,
    redirectToDiscordLink,
  };
}
