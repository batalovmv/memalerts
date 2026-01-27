import { useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

import { ensureMinDuration } from '@/shared/lib/ensureMinDuration';
import { Button } from '@/shared/ui';

type OutboxStatus = 'pending' | 'processing' | 'sent' | 'failed';
type OutboxLastError = 'bot_not_joined' | string | null;

type OutboxStatusResponse = {
  provider?: 'twitch' | 'youtube' | 'vkvideo' | string;
  id?: string;
  status?: OutboxStatus | string;
  attempts?: number;
  lastError?: OutboxLastError;
  processingAt?: string | null;
  sentAt?: string | null;
  failedAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export const useBotOutbox = () => {
  const { t } = useTranslation();

  const [testMessage, setTestMessage] = useState('');
  const [sendingTestMessage, setSendingTestMessage] = useState(false);
  const [lastOutbox, setLastOutbox] = useState<null | {
    provider: 'twitch' | 'youtube' | 'vkvideo';
    id?: string;
    status?: string;
    attempts?: number;
    lastError?: OutboxLastError;
    timedOut?: boolean;
    processingAt?: string | null;
    sentAt?: string | null;
    failedAt?: string | null;
    createdAt?: string | null;
    updatedAt?: string | null;
  }>(null);
  const [lastOutboxRequest, setLastOutboxRequest] = useState<null | {
    provider: 'twitch' | 'youtube' | 'vkvideo';
    message: string;
  }>(null);

  const outboxPollTimerRef = useRef<number | null>(null);
  const outboxPollStartedAtRef = useRef<number>(0);
  const outboxPollInFlightRef = useRef(false);
  const outboxPollKeyRef = useRef<string>('');

  const queueBotSay = useCallback(
    async (provider: 'twitch' | 'youtube' | 'vkvideo', message: string) => {
      const msg = String(message || '').trim();
      if (!msg) {
        toast.error(t('admin.botTestMessageRequired', { defaultValue: 'Enter a message.' }));
        return;
      }

      const startedAt = Date.now();
      try {
        setSendingTestMessage(true);
        setLastOutboxRequest({ provider, message: msg });

        const { api } = await import('@/lib/api');
        const res = await api.post<{
          ok?: boolean;
          provider?: string;
          outbox?: { id?: string; status?: string; createdAt?: string };
        }>('/streamer/bot/say', { provider, message: msg });

        const usedProvider = typeof res?.provider === 'string' && res.provider.trim() ? res.provider.trim() : provider;
        const normalizedProvider =
          usedProvider === 'twitch' ||
          usedProvider === 'youtube' ||
          usedProvider === 'vkvideo'
            ? usedProvider
            : provider;

        if (res?.outbox && typeof res.outbox === 'object') {
          setLastOutbox({
            provider: normalizedProvider,
            id: res.outbox.id,
            status: res.outbox.status,
            createdAt: res.outbox.createdAt ?? null,
            updatedAt: null,
            attempts: 0,
            lastError: null,
            timedOut: false,
            processingAt: null,
            sentAt: null,
            failedAt: null,
          });
        } else {
          setLastOutbox(null);
        }

        toast.success(
          t('admin.botTestMessageQueued', {
            defaultValue: 'Сообщение поставлено в очередь ({{provider}}).',
            provider: usedProvider,
          })
        );
      } catch (error: unknown) {
        const apiError = error as {
          response?: {
            status?: number;
            data?: { error?: string; message?: string; enabledProviders?: string[] };
          };
        };
        const { getRequestIdFromError } = await import('@/lib/api');
        const rid = getRequestIdFromError(error);

        if (apiError.response?.status === 404) {
          toast.error(
            rid
              ? `${t('admin.botFeaturesNotAvailable', { defaultValue: 'This server does not support bot features yet.' })} (${t('common.errorId', { defaultValue: 'Error ID' })}: ${rid})`
              : t('admin.botFeaturesNotAvailable', { defaultValue: 'This server does not support bot features yet.' })
          );
          return;
        }

        if (
          apiError.response?.status === 400 &&
          Array.isArray(apiError.response?.data?.enabledProviders) &&
          apiError.response.data.enabledProviders.length > 1
        ) {
          toast.error(
            rid
              ? `${t('admin.botMultipleProvidersEnabled', {
                  defaultValue: 'Включено несколько чат-ботов. Выберите провайдера, куда отправлять сообщение.',
                })} (${t('common.errorId', { defaultValue: 'Error ID' })}: ${rid})`
              : t('admin.botMultipleProvidersEnabled', {
                  defaultValue: 'Включено несколько чат-ботов. Выберите провайдера, куда отправлять сообщение.',
                })
          );
          return;
        }

        if (apiError.response?.status === 400 && provider === 'youtube') {
          toast.error(
            rid
              ? `${t('admin.youtubeRelinkRequired', { defaultValue: 'Сначала привяжите YouTube заново (нужны новые разрешения).' })} (${t('common.errorId', { defaultValue: 'Error ID' })}: ${rid})`
              : t('admin.youtubeRelinkRequired', { defaultValue: 'Сначала привяжите YouTube заново (нужны новые разрешения).' })
          );
          return;
        }

        if (apiError.response?.status === 400 && provider === 'vkvideo') {
          toast.error(
            rid
              ? `${t('admin.vkvideoEnableRequiredToSend', { defaultValue: 'Сначала включите VKVideo-бота для канала.' })} (${t('common.errorId', { defaultValue: 'Error ID' })}: ${rid})`
              : t('admin.vkvideoEnableRequiredToSend', { defaultValue: 'Сначала включите VKVideo-бота для канала.' })
          );
          return;
        }

        const rawMsg =
          apiError.response?.data?.error ||
          apiError.response?.data?.message ||
          t('admin.failedToSendBotTestMessage', { defaultValue: 'Failed to send message.' });
        toast.error(rid ? `${rawMsg} (${t('common.errorId', { defaultValue: 'Error ID' })}: ${rid})` : rawMsg);
      } finally {
        await ensureMinDuration(startedAt, 450);
        setSendingTestMessage(false);
      }
    },
    [t]
  );

  const sendTestMessage = useCallback(
    async (provider: 'twitch' | 'youtube' | 'vkvideo') => {
      const msg = (testMessage || t('admin.botDefaultTestMessage', { defaultValue: 'Bot connected ?' })).trim();
      await queueBotSay(provider, msg);
    },
    [queueBotSay, t, testMessage]
  );

  const stopOutboxPolling = useCallback(() => {
    if (outboxPollTimerRef.current) {
      window.clearTimeout(outboxPollTimerRef.current);
      outboxPollTimerRef.current = null;
    }
    outboxPollInFlightRef.current = false;
  }, []);

  const pollOutboxOnce = useCallback(async () => {
    const scheduleNext = (delayMs: number) => {
      stopOutboxPolling();
      outboxPollTimerRef.current = window.setTimeout(() => {
        outboxPollTimerRef.current = null;
        void pollOutboxOnce();
      }, Math.max(250, delayMs));
    };

    const current = lastOutbox;
    if (!current?.id) return;
    const provider = current.provider;
    const id = String(current.id);
    const status = String(current.status || '').toLowerCase();
    if (status === 'sent' || status === 'failed') return;

    const elapsedMs = outboxPollStartedAtRef.current ? Date.now() - outboxPollStartedAtRef.current : 0;
    if (elapsedMs > 30 * 1000) {
      setLastOutbox((prev) => {
        if (!prev || prev.provider !== provider || String(prev.id || '') !== id) return prev;
        return { ...prev, timedOut: true };
      });
      return;
    }

    if (outboxPollInFlightRef.current) return;
    outboxPollInFlightRef.current = true;
    try {
      const { api } = await import('@/lib/api');
      const res = await api.get<OutboxStatusResponse>(
        `/streamer/bot/outbox/${encodeURIComponent(provider)}/${encodeURIComponent(id)}`,
        { timeout: 8000 }
      );

      setLastOutbox((prev) => {
        if (!prev || prev.provider !== provider || String(prev.id || '') !== id) return prev;
        return {
          ...prev,
          status: typeof res?.status === 'string' ? res.status : prev.status,
          attempts: typeof res?.attempts === 'number' ? res.attempts : prev.attempts,
          lastError: (res?.lastError ?? prev.lastError ?? null) as OutboxLastError,
          processingAt: (res?.processingAt ?? prev.processingAt ?? null) as string | null,
          sentAt: (res?.sentAt ?? prev.sentAt ?? null) as string | null,
          failedAt: (res?.failedAt ?? prev.failedAt ?? null) as string | null,
          createdAt: (res?.createdAt ?? prev.createdAt ?? null) as string | null,
          updatedAt: (res?.updatedAt ?? prev.updatedAt ?? null) as string | null,
        };
      });

      const nextStatus = String(res?.status || status).toLowerCase();
      if (nextStatus === 'sent' || nextStatus === 'failed') return;

      const nextDelay = nextStatus === 'processing' ? 2000 : 1200;
      scheduleNext(nextDelay);
    } catch {
      scheduleNext(2500);
    } finally {
      outboxPollInFlightRef.current = false;
    }
  }, [lastOutbox, stopOutboxPolling]);

  useEffect(() => {
    if (!lastOutbox?.id) {
      stopOutboxPolling();
      outboxPollStartedAtRef.current = 0;
      outboxPollKeyRef.current = '';
      return;
    }
    const status = String(lastOutbox.status || '').toLowerCase();
    if (status === 'sent' || status === 'failed') {
      stopOutboxPolling();
      return;
    }
    const key = `${lastOutbox.provider}:${String(lastOutbox.id)}`;
    if (outboxPollKeyRef.current !== key) {
      outboxPollKeyRef.current = key;
      outboxPollStartedAtRef.current = Date.now();
    }
    stopOutboxPolling();
    outboxPollTimerRef.current = window.setTimeout(() => {
      outboxPollTimerRef.current = null;
      void pollOutboxOnce();
    }, 650);
    return () => stopOutboxPolling();
  }, [lastOutbox?.id, lastOutbox?.provider, stopOutboxPolling, pollOutboxOnce, lastOutbox?.status]);

  const renderOutboxStatus = useCallback(
    (provider: 'twitch' | 'youtube' | 'vkvideo') => {
      if (!lastOutbox || lastOutbox.provider !== provider) return null;

      const status = String(lastOutbox.status || 'unknown');
      const lastError = (lastOutbox.lastError ?? null) as OutboxLastError;
      const attempts = typeof lastOutbox.attempts === 'number' ? lastOutbox.attempts : null;
      const normalized = status.toLowerCase();
      const canRetry = normalized === 'failed' && lastOutboxRequest?.provider === provider && !!lastOutboxRequest?.message;

      return (
        <div className="text-xs text-gray-600 dark:text-gray-300">
          {t('admin.botOutboxStatus', {
            defaultValue: 'Outbox status: {{status}}',
            status,
          })}
          {typeof attempts === 'number' ? (
            <span className="ml-2 opacity-80">
              {t('admin.botOutboxAttempts', { defaultValue: 'attempts: {{n}}', n: attempts })}
            </span>
          ) : null}
          {lastOutbox.id ? (
            <div className="mt-1">
              <span className="opacity-80">Outbox ID: </span>
              <span className="font-mono">{lastOutbox.id}</span>
              <button
                type="button"
                className="ml-2 underline hover:no-underline"
                onClick={() => {
                  try {
                    void navigator.clipboard.writeText(String(lastOutbox.id));
                    toast.success(t('common.copied', { defaultValue: 'Copied.' }));
                  } catch {
                    // ignore
                  }
                }}
              >
                {t('common.copy', { defaultValue: 'Copy' })}
              </button>
            </div>
          ) : null}

          {lastOutbox.timedOut && normalized !== 'sent' && normalized !== 'failed' ? (
            <div className="mt-1 text-amber-800 dark:text-amber-200">
              {t('admin.botOutboxPendingLong', {
                defaultValue: 'Ожидаем доставку ботом: Если долго не меняется - отправьте Outbox ID в поддержку.',
              })}
            </div>
          ) : null}

          {lastError === 'bot_not_joined' ? (
            <div className="mt-1 text-amber-800 dark:text-amber-200">
              {t('admin.botOutboxBotNotJoined', {
                defaultValue:
                  'Бот-раннер ещё не подключился к чату (не joined) или не запущен. Подождите и попробуйте снова позже.',
              })}
            </div>
          ) : lastError ? (
            <div className="mt-1 text-amber-800 dark:text-amber-200">
              {t('admin.botOutboxLastError', { defaultValue: 'Last error: {{err}}', err: String(lastError) })}
            </div>
          ) : null}

          {canRetry ? (
            <div className="mt-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => void queueBotSay(provider, lastOutboxRequest!.message)}
                disabled={sendingTestMessage}
              >
                {t('admin.botOutboxRetry', { defaultValue: 'Повторить' })}
              </Button>
            </div>
          ) : null}
        </div>
      );
    },
    [lastOutbox, lastOutboxRequest, queueBotSay, sendingTestMessage, t]
  );

  return {
    testMessage,
    setTestMessage,
    sendingTestMessage,
    sendTestMessage,
    renderOutboxStatus,
    lastOutbox,
    lastOutboxRequest,
  };
};

export type UseBotOutboxResult = ReturnType<typeof useBotOutbox>;
