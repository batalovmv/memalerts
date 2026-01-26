import { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

import type { BotIntegration } from '@/features/dashboard/types';
import type { User } from '@memalerts/api-contracts';

import { api } from '@/lib/api';

type UseDashboardBotsOptions = {
  user: User | null | undefined;
};

export function useDashboardBots({ user }: UseDashboardBotsOptions) {
  const { t } = useTranslation();
  const [bots, setBots] = useState<BotIntegration[]>([]);
  const [botsLoaded, setBotsLoaded] = useState(false);
  const [botsLoading, setBotsLoading] = useState(false);

  const loadBots = useCallback(async () => {
    if (botsLoading) return;
    try {
      setBotsLoading(true);
      const resp = await api.get<{ items?: Array<{ provider?: string; enabled?: boolean | null }>; bots?: Array<{ provider?: string; enabled?: boolean | null }> }>(
        '/streamer/bots',
        { timeout: 12000 }
      );
      const normalizeBot = (bot?: { provider?: string; enabled?: boolean | null } | null): BotIntegration | null => {
        const provider = String(bot?.provider || '').trim();
        if (!provider) return null;
        return { provider, enabled: bot?.enabled ?? null };
      };
      const list = Array.isArray(resp?.items)
        ? resp.items.map(normalizeBot).filter((item): item is BotIntegration => !!item)
        : Array.isArray(resp?.bots)
          ? resp.bots.map(normalizeBot).filter((item): item is BotIntegration => !!item)
          : [];
      setBots(list);
      setBotsLoaded(true);
    } catch {
      setBotsLoaded(true);
    } finally {
      setBotsLoading(false);
    }
  }, [botsLoading]);

  useEffect(() => {
    if (!user) return;
    if (user.role !== 'streamer' && user.role !== 'admin') return;
    if (!botsLoaded) void loadBots();
  }, [botsLoaded, loadBots, user]);

  const visibleBots = useMemo(() => {
    return bots.filter((b) => {
      const provider = String(b?.provider || '').trim().toLowerCase();
      if (!provider) return false;
      return true;
    });
  }, [bots]);
  const anyBotEnabled = useMemo(() => visibleBots.some((b) => b?.enabled === true), [visibleBots]);
  const allBotsEnabled = useMemo(() => visibleBots.length > 0 && visibleBots.every((b) => b?.enabled === true), [visibleBots]);

  const toggleAllBots = useCallback(
    async (nextEnabled: boolean) => {
      if (botsLoading) return;
      // Optimistic
      setBots((prev) => prev.map((b) => ({ ...b, enabled: nextEnabled })));
      try {
        setBotsLoading(true);
        const providersToToggle = visibleBots;
        const uniqueProviders = Array.from(
          new Set(
            providersToToggle
              .map((b) => String(b?.provider || '').trim())
              .map((p) => p.toLowerCase())
              .filter(Boolean)
          )
        );
        const results = await Promise.allSettled(
          uniqueProviders.map((provider) => api.patch(`/streamer/bots/${encodeURIComponent(provider)}`, { enabled: nextEnabled }))
        );
        const rejected = results
          .map((r, idx) => ({ r, provider: uniqueProviders[idx] || 'unknown' }))
          .filter((x) => x.r.status === 'rejected') as Array<{ r: PromiseRejectedResult; provider: string }>;
        const failed = rejected.length;
        if (failed > 0) {
          const hasYouTubeRelink = rejected.some((x) => {
            const e = x.r.reason as { response?: { status?: number; data?: { code?: unknown; needsRelink?: unknown } } };
            return e?.response?.status === 412 && e?.response?.data?.code === 'YOUTUBE_RELINK_REQUIRED';
          });
          if (hasYouTubeRelink) {
            toast.error(
              t('dashboard.bots.youtubeRelinkRequired', {
                defaultValue: 'YouTube needs re-linking (missing permissions). Open Settings → Bot to reconnect.',
              })
            );
          }
          toast.error(
            t('dashboard.bots.failedPartial', {
              defaultValue: 'Some bots failed to update. Please retry.',
            })
          );
        } else {
          toast.success(
            nextEnabled
              ? t('dashboard.bots.enabledAll', { defaultValue: 'All bots enabled.' })
              : t('dashboard.bots.disabledAll', { defaultValue: 'All bots disabled.' })
          );
        }
        // Re-load best-effort to reflect backend truth
        void loadBots();
      } catch {
        toast.error(t('dashboard.bots.failedAll', { defaultValue: 'Failed to update bots' }));
        void loadBots();
      } finally {
        setBotsLoading(false);
      }
    },
    [botsLoading, loadBots, t, visibleBots]
  );

  return {
    botsLoaded,
    botsLoading,
    visibleBots,
    anyBotEnabled,
    allBotsEnabled,
    toggleAllBots,
  };
}

