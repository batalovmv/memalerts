import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

import { ensureMinDuration } from '@/shared/lib/ensureMinDuration';

type UseBotSubscriptionOptions = {
  twitchLinked: boolean;
};

export const useBotSubscription = ({ twitchLinked }: UseBotSubscriptionOptions) => {
  const { t } = useTranslation();

  const [loading, setLoading] = useState<'toggle' | 'load' | null>(null);
  const [botEnabled, setBotEnabled] = useState<boolean | null>(null);
  const [statusLoaded, setStatusLoaded] = useState(false);
  const [twitchBotNotConfiguredHint, setTwitchBotNotConfiguredHint] = useState(false);

  const loadSubscription = useCallback(async () => {
    const TTL_MS = 10_000;
    const cacheKey = 'memalerts:botSettings:subscription';
    try {
      const raw = sessionStorage.getItem(cacheKey);
      if (raw) {
        const parsed = JSON.parse(raw) as { at?: unknown; enabled?: unknown };
        const at = typeof parsed?.at === 'number' ? parsed.at : 0;
        if (at > 0 && Date.now() - at < TTL_MS) {
          if (typeof parsed.enabled === 'boolean') setBotEnabled(parsed.enabled);
          else setBotEnabled(null);
          setStatusLoaded(true);
          return;
        }
      }
    } catch {
      // ignore cache
    }
    try {
      setLoading('load');
      const { api } = await import('@/lib/api');
      const res = await api.get<{ enabled?: boolean | null }>('/streamer/bot/subscription', { timeout: 8000 });
      if (typeof res?.enabled === 'boolean') {
        setBotEnabled(res.enabled);
      } else {
        setBotEnabled(null);
      }
      try {
        sessionStorage.setItem(
          cacheKey,
          JSON.stringify({
            at: Date.now(),
            enabled: typeof res?.enabled === 'boolean' ? res.enabled : null,
          })
        );
      } catch {
        // ignore cache write
      }
    } catch (error: unknown) {
      const apiError = error as { response?: { status?: number } };
      if (apiError.response?.status === 404) {
        setBotEnabled(null);
        return;
      }
      setBotEnabled(null);
    } finally {
      setStatusLoaded(true);
      setLoading(null);
    }
  }, []);

  useEffect(() => {
    void loadSubscription();
  }, [loadSubscription]);

  const callToggle = async (nextEnabled: boolean) => {
    const startedAt = Date.now();
    try {
      if (!twitchLinked) {
        toast.error(t('admin.twitchChannelNotLinked', { defaultValue: 'This channel is not linked to Twitch.' }));
        return;
      }
      setTwitchBotNotConfiguredHint(false);
      setLoading('toggle');
      const { api } = await import('@/lib/api');
      await api.post(nextEnabled ? '/streamer/bot/enable' : '/streamer/bot/disable');
      setBotEnabled(nextEnabled);
      try {
        sessionStorage.setItem('memalerts:botSettings:subscription', JSON.stringify({ at: Date.now(), enabled: nextEnabled }));
      } catch {
        // ignore cache write
      }
      toast.success(nextEnabled ? t('admin.botEnabled', { defaultValue: 'Bot enabled.' }) : t('admin.botDisabled', { defaultValue: 'Bot disabled.' }));
    } catch (error: unknown) {
      const apiError = error as { response?: { status?: number; data?: { error?: string; message?: string; errorCode?: string } } };
      const { getRequestIdFromError } = await import('@/lib/api');
      const rid = getRequestIdFromError(error);
      const fallback =
        nextEnabled
          ? t('admin.failedToEnableBot', { defaultValue: 'Failed to enable bot.' })
          : t('admin.failedToDisableBot', { defaultValue: 'Failed to disable bot.' });

      const rawMsg = apiError.response?.data?.error || apiError.response?.data?.message || fallback;
      const errorCode = apiError.response?.data?.errorCode;
      const code = String((apiError.response?.data as { code?: unknown } | undefined)?.code || '');
      if (apiError.response?.status === 503 && code === 'TWITCH_BOT_NOT_CONFIGURED') {
        setTwitchBotNotConfiguredHint(true);
        const hint = t('admin.twitchBotNotConfiguredHint', {
          defaultValue: 'Нужен отправитель сообщений: подключите своего бота или попросите админа подключить дефолтного.',
        });
        toast.error(rid ? `${hint} (${t('common.errorId', { defaultValue: 'Error ID' })}: ${rid})` : hint);
        return;
      }
      const msg =
        apiError.response?.status === 400 &&
        (errorCode === 'TWITCH_CHANNEL_NOT_LINKED' || String(rawMsg).includes('not linked to Twitch'))
          ? t('admin.twitchChannelNotLinked', { defaultValue: 'This channel is not linked to Twitch.' })
          : rawMsg;
      toast.error(rid ? `${msg} (${t('common.errorId', { defaultValue: 'Error ID' })}: ${rid})` : msg);
    } finally {
      await ensureMinDuration(startedAt, 500);
      setLoading(null);
    }
  };

  const isBusy = loading !== null;
  const showMenus = botEnabled === true;
  const menusDisabled = !showMenus || isBusy;

  return {
    botEnabled,
    statusLoaded,
    loading,
    isBusy,
    showMenus,
    menusDisabled,
    twitchBotNotConfiguredHint,
    setTwitchBotNotConfiguredHint,
    callToggle,
  };
};

export type UseBotSubscriptionResult = ReturnType<typeof useBotSubscription>;
