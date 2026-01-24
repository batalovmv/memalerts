import { useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

import type { PublicSubmissionsStatus, SubmissionsControlState } from '@/features/dashboard/types';
import type { User } from '@/types';

import { api } from '@/lib/api';
import { getPublicSubmissionsStatus, rotateSubmissionsControlLink as rotateSubmissionsControlLinkApi } from '@/shared/api/submissions';

type UseDashboardSubmissionsControlOptions = {
  user: User | null | undefined;
};

export function useDashboardSubmissionsControl({ user }: UseDashboardSubmissionsControlOptions) {
  const { t } = useTranslation();
  const [memesCount, setMemesCount] = useState<number | null>(null);
  const [submissionsEnabled, setSubmissionsEnabled] = useState<boolean | null>(null);
  const [submissionsOnlyWhenLive, setSubmissionsOnlyWhenLive] = useState<boolean | null>(null);
  const [savingSubmissionsSettings, setSavingSubmissionsSettings] = useState<null | 'enabled' | 'onlyWhenLive'>(null);
  const [memeCatalogMode, setMemeCatalogMode] = useState<null | 'channel' | 'pool_all'>(null);
  const [savingMemeCatalogMode, setSavingMemeCatalogMode] = useState(false);
  const [submissionsControl, setSubmissionsControl] = useState<SubmissionsControlState | null>(null);
  const [rotatingSubmissionsControl, setRotatingSubmissionsControl] = useState(false);
  const [submissionsControlStatus, setSubmissionsControlStatus] = useState<PublicSubmissionsStatus | null>(null);
  const [loadingSubmissionsControlStatus, setLoadingSubmissionsControlStatus] = useState(false);
  const lastStatusTokenRef = useRef<string>('');

  useEffect(() => {
    if (!user?.channel?.slug) return;
    void (async () => {
      try {
        const slug = user.channel?.slug;
        if (!slug) return;
        const data = await api.get<{
          stats?: { memesCount?: number };
          submissionsEnabled?: boolean;
          submissionsOnlyWhenLive?: boolean;
          memeCatalogMode?: 'channel' | 'pool_all' | null;
        }>(`/channels/${slug}`, {
          // Avoid stale cached channel settings after a recent PATCH (CDN/proxy/browser caches).
          params: { includeMemes: false, _ts: Date.now() },
          headers: { 'Cache-Control': 'no-store' },
        });
        const count = data?.stats?.memesCount;
        if (typeof count === 'number') setMemesCount(count);
        if (typeof data?.submissionsEnabled === 'boolean') setSubmissionsEnabled(data.submissionsEnabled);
        if (typeof data?.submissionsOnlyWhenLive === 'boolean') setSubmissionsOnlyWhenLive(data.submissionsOnlyWhenLive);
        if (data?.memeCatalogMode === 'pool_all' || data?.memeCatalogMode === 'channel') setMemeCatalogMode(data.memeCatalogMode);
        else setMemeCatalogMode('channel');
      } catch {
        // ignore
      }
    })();
  }, [user?.channel?.slug]);

  const saveSubmissionSettings = useCallback(
    async (patch: { submissionsEnabled?: boolean; submissionsOnlyWhenLive?: boolean }, kind: 'enabled' | 'onlyWhenLive') => {
      if (!user?.channelId) return;
      if (savingSubmissionsSettings) return;
      try {
        setSavingSubmissionsSettings(kind);
        const resp = await api.patch<{
          submissionsEnabled?: boolean;
          submissionsOnlyWhenLive?: boolean;
        }>('/streamer/channel/settings', patch);
        // Prefer server response, but keep local optimistic value if missing.
        if (typeof resp?.submissionsEnabled === 'boolean') setSubmissionsEnabled(resp.submissionsEnabled);
        if (typeof resp?.submissionsOnlyWhenLive === 'boolean') setSubmissionsOnlyWhenLive(resp.submissionsOnlyWhenLive);
        toast.success(t('dashboard.submissions.saved', { defaultValue: 'Saved' }));
      } catch (error: unknown) {
        const apiError = error as { response?: { data?: { error?: string } } };
        toast.error(apiError.response?.data?.error || t('admin.failedToSaveSettings', { defaultValue: 'Failed to save settings' }));
        // Re-fetch to resync (best-effort)
        try {
          const slug = user?.channel?.slug;
          if (slug) {
            const data = await api.get<{ submissionsEnabled?: boolean; submissionsOnlyWhenLive?: boolean }>(`/channels/${slug}`, {
              params: { includeMemes: false, _ts: Date.now() },
              headers: { 'Cache-Control': 'no-store' },
            });
            if (typeof data?.submissionsEnabled === 'boolean') setSubmissionsEnabled(data.submissionsEnabled);
            if (typeof data?.submissionsOnlyWhenLive === 'boolean') setSubmissionsOnlyWhenLive(data.submissionsOnlyWhenLive);
          }
        } catch {
          // ignore
        }
      } finally {
        setSavingSubmissionsSettings(null);
      }
    },
    [savingSubmissionsSettings, t, user?.channel?.slug, user?.channelId]
  );

  const saveMemeCatalogMode = useCallback(
    async (nextMode: 'channel' | 'pool_all') => {
      if (!user?.channelId) return;
      if (savingMemeCatalogMode) return;
      const prev = memeCatalogMode;
      try {
        setSavingMemeCatalogMode(true);
        const resp = await api.patch<{ memeCatalogMode?: 'channel' | 'pool_all' }>(
          '/streamer/channel/settings',
          { memeCatalogMode: nextMode },
        );
        if (resp?.memeCatalogMode === 'channel' || resp?.memeCatalogMode === 'pool_all') {
          setMemeCatalogMode(resp.memeCatalogMode);
          toast.success(t('dashboard.memeCatalogMode.saved', { defaultValue: 'Saved' }));
          return;
        }

        // Back-compat: some environments return `{ ok: true }` or omit the field.
        // Keep optimistic value and report success; next page load will reflect canonical server state.
        toast.success(t('dashboard.memeCatalogMode.saved', { defaultValue: 'Saved' }));
      } catch (error: unknown) {
        const apiError = error as { response?: { data?: { error?: string } } };
        toast.error(apiError.response?.data?.error || t('admin.failedToSaveSettings', { defaultValue: 'Failed to save settings' }));
        if (prev === 'channel' || prev === 'pool_all') setMemeCatalogMode(prev);
        // Re-fetch best-effort to resync.
        try {
          const slug = user?.channel?.slug;
          if (slug) {
            const data = await api.get<{ memeCatalogMode?: 'channel' | 'pool_all' }>(`/channels/${slug}`, {
              params: { includeMemes: false, _ts: Date.now() },
              headers: { 'Cache-Control': 'no-store' },
            });
            if (data?.memeCatalogMode === 'channel' || data?.memeCatalogMode === 'pool_all') setMemeCatalogMode(data.memeCatalogMode);
          }
        } catch {
          // ignore
        }
      } finally {
        setSavingMemeCatalogMode(false);
      }
    },
    [memeCatalogMode, savingMemeCatalogMode, t, user?.channel?.slug, user?.channelId],
  );

  const refreshSubmissionsControlStatus = useCallback(
    async (token: string) => {
      const trimmed = String(token || '').trim();
      if (!trimmed) return;
      if (loadingSubmissionsControlStatus) return;
      try {
        setLoadingSubmissionsControlStatus(true);
        const resp = await getPublicSubmissionsStatus(trimmed);
        if (resp) {
          setSubmissionsControlStatus({
            enabled: !!resp.enabled,
            channelSlug: resp.channelSlug,
          });
        }
      } catch (error: unknown) {
        const apiError = error as { response?: { status?: number; data?: { error?: string } } };
        if (apiError.response?.status === 404) {
          setSubmissionsControlStatus(null);
          toast.error(t('dashboard.submissionsControl.invalidToken', { defaultValue: 'Token is invalid. Rotate the link to generate a new one.' }));
        } else {
          toast.error(t('dashboard.submissionsControl.failedToLoadStatus', { defaultValue: 'Failed to load status' }));
        }
      } finally {
        setLoadingSubmissionsControlStatus(false);
      }
    },
    [loadingSubmissionsControlStatus, t]
  );

  const rotateSubmissionsControlLink = useCallback(async () => {
    if (rotatingSubmissionsControl) return;
    try {
      setRotatingSubmissionsControl(true);
      const resp = await rotateSubmissionsControlLinkApi();
      if (resp?.token && resp?.url) {
        setSubmissionsControl({ revealable: true, token: resp.token, url: resp.url });
        lastStatusTokenRef.current = resp.token;
        void refreshSubmissionsControlStatus(resp.token);
        toast.success(t('dashboard.submissionsControl.rotated', { defaultValue: 'Link generated. Save it - it cannot be shown again.' }));
      } else {
        toast.error(t('dashboard.submissionsControl.failedToRotate', { defaultValue: 'Failed to rotate link' }));
      }
    } catch (error: unknown) {
      const apiError = error as { response?: { data?: { error?: string } } };
      toast.error(apiError.response?.data?.error || t('dashboard.submissionsControl.failedToRotate', { defaultValue: 'Failed to rotate link' }));
    } finally {
      setRotatingSubmissionsControl(false);
    }
  }, [refreshSubmissionsControlStatus, rotatingSubmissionsControl, t]);

  useEffect(() => {
    const token = (submissionsControl?.revealable && submissionsControl?.token) ? submissionsControl.token : '';
    if (!token || lastStatusTokenRef.current === token) return;
    void refreshSubmissionsControlStatus(token);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submissionsControl?.token]);

  return {
    memesCount,
    submissionsEnabled,
    submissionsOnlyWhenLive,
    savingSubmissionsSettings,
    memeCatalogMode,
    savingMemeCatalogMode,
    submissionsControl,
    submissionsControlStatus,
    rotatingSubmissionsControl,
    setSubmissionsEnabled,
    setSubmissionsOnlyWhenLive,
    setMemeCatalogMode,
    saveSubmissionSettings,
    saveMemeCatalogMode,
    rotateSubmissionsControlLink,
  };
}
