import { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

import type { ApiErrorShape, BotStatusApi, StreamerBotIntegration } from '../types';

import { ensureMinDuration } from '@/shared/lib/ensureMinDuration';

export const useBotIntegrations = () => {
  const { t } = useTranslation();

  const [botsLoaded, setBotsLoaded] = useState(false);
  const [botsLoading, setBotsLoading] = useState(false);
  const [bots, setBots] = useState<StreamerBotIntegration[]>([]);
  const [botIntegrationToggleLoading, setBotIntegrationToggleLoading] = useState<string | null>(null);
  const [youtubeNeedsRelink, setYoutubeNeedsRelink] = useState(false);
  const [youtubeLastRelinkErrorId, setYoutubeLastRelinkErrorId] = useState<string | null>(null);
  const [vkvideoNotAvailable, setVkvideoNotAvailable] = useState(false);

  const loadBotIntegrations = useCallback(async () => {
    const TTL_MS = 10_000;
    const cacheKey = 'memalerts:botSettings:bots';
    try {
      const raw = sessionStorage.getItem(cacheKey);
      if (raw) {
        const parsed = JSON.parse(raw) as { at?: unknown; items?: unknown };
        const at = typeof parsed?.at === 'number' ? parsed.at : 0;
        if (at > 0 && Date.now() - at < TTL_MS) {
          const items = Array.isArray(parsed.items) ? (parsed.items as StreamerBotIntegration[]) : [];
          setBots(items);
          const yt = items.find((b) => b.provider === 'youtube');
          if (yt?.enabled === true) setYoutubeNeedsRelink(false);
          setBotsLoaded(true);
          return;
        }
      }
    } catch {
      // ignore cache
    }
    try {
      setBotsLoading(true);
      const { api } = await import('@/lib/api');
      const res = await api.get<{ items?: StreamerBotIntegration[]; bots?: BotStatusApi[] }>('/streamer/bots', { timeout: 8000 });
      let items: StreamerBotIntegration[] = [];
      if (Array.isArray(res?.items)) {
        items = res.items
          .map((item) => ({
            ...item,
            provider: String(item?.provider || '').trim().toLowerCase(),
          }))
          .filter((item) => item.provider);
      } else if (Array.isArray(res?.bots)) {
        items = res.bots
          .map((bot) => {
            const provider = String(bot?.provider || '').trim().toLowerCase();
            if (!provider) return null;
            return {
              provider,
              enabled: bot?.enabled,
              updatedAt: bot?.updatedAt ?? null,
              useDefaultBot: bot?.useDefaultBot,
              customBotLinked: bot?.customBotLinked,
              customBotDisplayName: bot?.customBotDisplayName ?? null,
              channelUrl: bot?.channelUrl ?? null,
              vkvideoChannelUrl: provider === 'vkvideo' ? bot?.channelUrl ?? null : undefined,
            } as StreamerBotIntegration;
          })
          .filter((item): item is StreamerBotIntegration => !!item);
      }
      setBots(items);
      const yt = items.find((b) => b.provider === 'youtube');
      if (yt?.enabled === true) setYoutubeNeedsRelink(false);

      setBotsLoaded(true);
      try {
        sessionStorage.setItem(cacheKey, JSON.stringify({ at: Date.now(), items }));
      } catch {
        // ignore cache write
      }
    } catch {
      setBotsLoaded(false);
    } finally {
      setBotsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadBotIntegrations();
  }, [loadBotIntegrations]);

  const isYoutubeRelinkRequiredError = useCallback((error: unknown): boolean => {
    const apiError = error as ApiErrorShape;
    if (apiError.response?.status !== 412) return false;
    const data = apiError.response?.data || {};
    return data?.code === 'YOUTUBE_RELINK_REQUIRED' || data?.needsRelink === true;
  }, []);

  const getYoutubeEnableErrorMessage = useCallback(
    async (error: unknown): Promise<{ message: string; requestId: string | null } | null> => {
      const apiError = error as ApiErrorShape;
      const status = apiError.response?.status ?? null;
      const data = apiError.response?.data || {};
      const code = typeof data?.code === 'string' ? data.code : null;
      const { getRequestIdFromError } = await import('@/lib/api');
      const requestId = getRequestIdFromError(error);

      if (status === 412 && code === 'YOUTUBE_RELINK_REQUIRED') return null;

      if (status === 409 && code === 'YOUTUBE_CHANNEL_REQUIRED') {
        return {
          message: t('admin.youtubeChannelRequired', {
            defaultValue: 'У аккаунта нет YouTube-канала. Создайте/активируйте канал и попробуйте снова.',
          }),
          requestId,
        };
      }

      if (status === 503 && code === 'YOUTUBE_API_NOT_CONFIGURED') {
        return {
          message: t('admin.youtubeApiNotConfigured', {
            defaultValue: 'YouTube Data API не настроен на сервере. Обратитесь в поддержку.',
          }),
          requestId,
        };
      }

      if (status === 503 && code === 'YOUTUBE_API_QUOTA') {
        return {
          message: t('admin.youtubeApiQuota', {
            defaultValue: 'Квота YouTube API исчерпана. Попробуйте позже.',
          }),
          requestId,
        };
      }

      if (status === 503 && code === 'YOUTUBE_BOT_NOT_CONFIGURED') {
        return {
          message: t('admin.youtubeBotNotConfigured', {
            defaultValue:
              'Нужен отправитель сообщений: подключите своего бота или попросите админа подключить дефолтного.',
          }),
          requestId,
        };
      }

      if (status === 412 && code) {
        const serverMessage = typeof data?.error === 'string' ? data.error : null;
        return {
          message:
            serverMessage ||
            t('admin.youtubeEnablePreconditionFailed', {
              defaultValue: 'Не удалось включить YouTube-бота (предусловие не выполнено).',
            }),
          requestId,
        };
      }

      return null;
    },
    [t]
  );

  const toggleBotIntegration = useCallback(
    async (provider: 'youtube', nextEnabled: boolean) => {
      const startedAt = Date.now();
      let optimisticItems: StreamerBotIntegration[] | null = null;
      try {
        setBotIntegrationToggleLoading(provider);
        if (provider === 'youtube' && !nextEnabled) {
          setYoutubeNeedsRelink(false);
          setYoutubeLastRelinkErrorId(null);
        }
        setBots((prev) => {
          const next = prev.map((b) => (b.provider === provider ? { ...b, enabled: nextEnabled } : b));
          optimisticItems = next;
          return next;
        });

        const { api } = await import('@/lib/api');
        await api.patch(`/streamer/bots/${encodeURIComponent(provider)}`, { enabled: nextEnabled });
        toast.success(t('admin.saved', { defaultValue: 'Saved.' }));
        try {
          if (optimisticItems) {
            sessionStorage.setItem('memalerts:botSettings:bots', JSON.stringify({ at: Date.now(), items: optimisticItems }));
          }
        } catch {
          // ignore cache write
        }
        void loadBotIntegrations();
      } catch (error: unknown) {
        void loadBotIntegrations();
        if (provider === 'youtube' && nextEnabled && isYoutubeRelinkRequiredError(error)) {
          setYoutubeNeedsRelink(true);
          try {
            const { getRequestIdFromError } = await import('@/lib/api');
            setYoutubeLastRelinkErrorId(getRequestIdFromError(error));
          } catch {
            setYoutubeLastRelinkErrorId(null);
          }
          return;
        }
        if (provider === 'youtube' && nextEnabled) {
          const extra = await getYoutubeEnableErrorMessage(error);
          if (extra) {
            toast.error(
              extra.requestId
                ? `${extra.message} (${t('common.errorId', { defaultValue: 'Error ID' })}: ${extra.requestId})`
                : extra.message
            );
            return;
          }
        }
        const { getRequestIdFromError } = await import('@/lib/api');
        const rid = getRequestIdFromError(error);
        const apiError = error as { response?: { status?: number; data?: { error?: string; message?: string } } };
        const msg =
          apiError.response?.data?.error ||
          apiError.response?.data?.message ||
          t('admin.failedToSave', { defaultValue: 'Failed to save.' });
        toast.error(rid ? `${msg} (${t('common.errorId', { defaultValue: 'Error ID' })}: ${rid})` : msg);
      } finally {
        await ensureMinDuration(startedAt, 450);
        setBotIntegrationToggleLoading(null);
      }
    },
    [getYoutubeEnableErrorMessage, isYoutubeRelinkRequiredError, loadBotIntegrations, t]
  );

  const toggleVkvideoIntegration = useCallback(
    async (nextEnabled: boolean) => {
      const startedAt = Date.now();
      let optimisticItems: StreamerBotIntegration[] | null = null;
      try {
        setBotIntegrationToggleLoading('vkvideo');
        const { api } = await import('@/lib/api');

        if (!nextEnabled) {
          setBots((prev) => {
            const next = prev.map((b) => (b.provider === 'vkvideo' ? { ...b, enabled: false } : b));
            optimisticItems = next;
            return next;
          });
          await api.patch('/streamer/bots/vkvideo', { enabled: false });
          setVkvideoNotAvailable(false);
          toast.success(t('admin.saved', { defaultValue: 'Saved.' }));
          try {
            if (optimisticItems) {
              sessionStorage.setItem('memalerts:botSettings:bots', JSON.stringify({ at: Date.now(), items: optimisticItems }));
            }
          } catch {
            // ignore cache write
          }
          void loadBotIntegrations();
          return;
        }

        setBots((prev) => {
          const next = prev.map((b) => (b.provider === 'vkvideo' ? { ...b, enabled: true } : b));
          optimisticItems = next;
          return next;
        });
        await api.patch('/streamer/bots/vkvideo', { enabled: true });

        setVkvideoNotAvailable(false);
        toast.success(t('admin.saved', { defaultValue: 'Saved.' }));
        try {
          if (optimisticItems) {
            sessionStorage.setItem('memalerts:botSettings:bots', JSON.stringify({ at: Date.now(), items: optimisticItems }));
          }
        } catch {
          // ignore cache write
        }
        void loadBotIntegrations();
      } catch (error: unknown) {
        void loadBotIntegrations();
        const apiError = error as { response?: { status?: number; data?: { error?: string; channels?: string[] } } };
        const code = (apiError.response?.data as { code?: unknown } | undefined)?.code;
        if (apiError.response?.status === 503 && code === 'VKVIDEO_BOT_NOT_CONFIGURED') {
          toast.error(
            t('admin.vkvideoBotNotConfigured', {
              defaultValue:
                'Нужен отправитель сообщений: подключите своего бота или попросите админа подключить дефолтного.',
            })
          );
          return;
        }
        if (apiError.response?.status === 404) {
          setVkvideoNotAvailable(true);
          toast.error(t('admin.featureNotAvailable', { defaultValue: 'Feature not available on this server yet.' }));
          return;
        }
        try {
          const { getRequestIdFromError } = await import('@/lib/api');
          const rid = getRequestIdFromError(error);
          const msg = apiError.response?.data?.error || t('admin.failedToSave', { defaultValue: 'Failed to save.' });
          toast.error(rid ? `${msg} (${t('common.errorId', { defaultValue: 'Error ID' })}: ${rid})` : msg);
        } catch {
          toast.error(apiError.response?.data?.error || t('admin.failedToSave', { defaultValue: 'Failed to save.' }));
        }
      } finally {
        await ensureMinDuration(startedAt, 450);
        setBotIntegrationToggleLoading(null);
      }
    },
    [loadBotIntegrations, t]
  );

  const botsMap = useMemo(() => new Map(bots.map((b) => [b.provider, b])), [bots]);
  const yt = botsMap.get('youtube');
  const ytEnabled = yt?.enabled === true;
  const ytBusy = botIntegrationToggleLoading === 'youtube';
  const vk = botsMap.get('vkvideo');
  const vkEnabled = vk?.enabled === true;
  const vkBusy = botIntegrationToggleLoading === 'vkvideo';

  return {
    bots,
    botsLoaded,
    botsLoading,
    botIntegrationToggleLoading,
    youtubeNeedsRelink,
    youtubeLastRelinkErrorId,
    vkvideoNotAvailable,
    botsMap,
    ytEnabled,
    ytBusy,
    vkEnabled,
    vkBusy,
    loadBotIntegrations,
    toggleBotIntegration,
    toggleVkvideoIntegration,
  };
};

export type UseBotIntegrationsResult = ReturnType<typeof useBotIntegrations>;
