import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { ensureMinDuration } from '@/shared/lib/ensureMinDuration';
import { Button, Input, Textarea } from '@/shared/ui';

type BotCommand = {
  id: string;
  trigger: string;
  response: string;
  enabled?: boolean;
  createdAt?: string;
};

export function BotSettings() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState<'toggle' | 'send' | 'commands' | null>(null);
  const [botEnabled, setBotEnabled] = useState<boolean | null>(null);
  const [testMessage, setTestMessage] = useState('');
  const [commands, setCommands] = useState<BotCommand[]>([]);
  const [newTrigger, setNewTrigger] = useState('');
  const [newResponse, setNewResponse] = useState('');
  const [commandsApiAvailable, setCommandsApiAvailable] = useState(true);

  const defaultTestMessage = useMemo(
    () => t('admin.botDefaultTestMessage', { defaultValue: 'Bot connected ✅' }),
    [t]
  );

  const callToggle = async (nextEnabled: boolean) => {
    const startedAt = Date.now();
    try {
      setLoading('toggle');
      const { api } = await import('@/lib/api');
      await api.post(nextEnabled ? '/streamer/bot/enable' : '/streamer/bot/disable');
      setBotEnabled(nextEnabled);
      toast.success(nextEnabled ? t('admin.botEnabled', { defaultValue: 'Bot enabled.' }) : t('admin.botDisabled', { defaultValue: 'Bot disabled.' }));
    } catch (error: unknown) {
      const apiError = error as { response?: { data?: { error?: string } } };
      const { getRequestIdFromError } = await import('@/lib/api');
      const rid = getRequestIdFromError(error);
      const fallback =
        nextEnabled
          ? t('admin.failedToEnableBot', { defaultValue: 'Failed to enable bot.' })
          : t('admin.failedToDisableBot', { defaultValue: 'Failed to disable bot.' });

      const msg = apiError.response?.data?.error || fallback;
      toast.error(rid ? `${msg} (${t('common.errorId', { defaultValue: 'Error ID' })}: ${rid})` : msg);
    } finally {
      await ensureMinDuration(startedAt, 500);
      setLoading(null);
    }
  };

  // Optional: try to load current enabled state (best-effort). If endpoint doesn't exist, UI still works (optimistic).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { api } = await import('@/lib/api');
        const res = await api.get<{ enabled?: boolean | null }>('/streamer/bot/subscription', { timeout: 8000 });
        if (cancelled) return;
        if (typeof res?.enabled === 'boolean') setBotEnabled(res.enabled);
      } catch (error: unknown) {
        const apiError = error as { response?: { status?: number } };
        // Backend may not support this endpoint yet (404). Don't show an error; fallback to optimistic toggle.
        if (apiError.response?.status === 404) return;
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const sendTestMessage = async () => {
    const startedAt = Date.now();
    const raw = testMessage.trim() || defaultTestMessage.trim();
    if (!raw) {
      toast.error(t('admin.botTestMessageRequired', { defaultValue: 'Enter a message.' }));
      return;
    }
    if (raw.length > 450) {
      toast.error(t('admin.botTestMessageTooLong', { defaultValue: 'Message is too long.' }));
      return;
    }

    try {
      setLoading('send'); // lock controls while sending
      const { api } = await import('@/lib/api');
      await api.post('/streamer/bot/say', { message: raw });
      toast.success(t('admin.botTestMessageSent', { defaultValue: 'Message sent.' }));
      setTestMessage('');
    } catch (error: unknown) {
      const apiError = error as { response?: { data?: { error?: string } } };
      const { getRequestIdFromError } = await import('@/lib/api');
      const rid = getRequestIdFromError(error);
      const msg =
        apiError.response?.data?.error ||
        t('admin.failedToSendBotTestMessage', { defaultValue: 'Failed to send message.' });
      toast.error(rid ? `${msg} (${t('common.errorId', { defaultValue: 'Error ID' })}: ${rid})` : msg);
    } finally {
      await ensureMinDuration(startedAt, 500);
      setLoading(null);
    }
  };

  const loadCommands = async () => {
    try {
      setLoading('commands');
      const { api } = await import('@/lib/api');
      const res = await api.get<{ items: BotCommand[] } | BotCommand[]>('/streamer/bot/commands', { timeout: 15000 });
      const items = Array.isArray(res) ? res : (res?.items || []);
      setCommands(items);
    } catch (error: unknown) {
      const apiError404 = error as { response?: { status?: number } };
      if (apiError404.response?.status === 404) {
        setCommandsApiAvailable(false);
        setCommands([]);
        return;
      }
      const apiError = error as { response?: { data?: { error?: string } } };
      toast.error(apiError.response?.data?.error || t('admin.failedToLoadBotCommands', { defaultValue: 'Failed to load commands.' }));
    } finally {
      setLoading(null);
    }
  };

  useEffect(() => {
    void loadCommands();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addCommand = async () => {
    const trigger = newTrigger.trim();
    const response = newResponse.trim();
    if (!trigger) {
      toast.error(t('admin.botCommandTriggerRequired', { defaultValue: 'Enter a trigger.' }));
      return;
    }
    if (!response) {
      toast.error(t('admin.botCommandResponseRequired', { defaultValue: 'Enter a response.' }));
      return;
    }
    if (trigger.length > 50) {
      toast.error(t('admin.botCommandTriggerTooLong', { defaultValue: 'Trigger is too long.' }));
      return;
    }
    if (response.length > 450) {
      toast.error(t('admin.botCommandResponseTooLong', { defaultValue: 'Response is too long.' }));
      return;
    }

    try {
      setLoading('commands');
      const { api } = await import('@/lib/api');
      const created = await api.post<BotCommand>('/streamer/bot/commands', { trigger, response });
      toast.success(t('admin.botCommandAdded', { defaultValue: 'Command added.' }));
      setNewTrigger('');
      setNewResponse('');
      setCommands((prev) => [created, ...prev]);
    } catch (error: unknown) {
      const apiError404 = error as { response?: { status?: number } };
      if (apiError404.response?.status === 404) {
        setCommandsApiAvailable(false);
      }
      const apiError = error as { response?: { data?: { error?: string } } };
      toast.error(apiError.response?.data?.error || t('admin.failedToAddBotCommand', { defaultValue: 'Failed to add command.' }));
    } finally {
      setLoading(null);
    }
  };

  const deleteCommand = async (id: string) => {
    try {
      setLoading('commands');
      const { api } = await import('@/lib/api');
      await api.delete(`/streamer/bot/commands/${id}`);
      setCommands((prev) => prev.filter((c) => c.id !== id));
      toast.success(t('admin.botCommandDeleted', { defaultValue: 'Command deleted.' }));
    } catch (error: unknown) {
      const apiError404 = error as { response?: { status?: number } };
      if (apiError404.response?.status === 404) {
        setCommandsApiAvailable(false);
      }
      const apiError = error as { response?: { data?: { error?: string } } };
      toast.error(apiError.response?.data?.error || t('admin.failedToDeleteBotCommand', { defaultValue: 'Failed to delete command.' }));
    } finally {
      setLoading(null);
    }
  };

  const isBusy = loading !== null;

  return (
    <div className="surface p-6">
      <h2 className="text-2xl font-bold mb-2 dark:text-white">{t('admin.botTitle', { defaultValue: 'Bot' })}</h2>
      <p className="text-sm text-gray-600 dark:text-gray-300 mb-5">
        {t('admin.botDescription', {
          defaultValue:
            'Enable/disable the chat bot subscription for your channel. The bot joins/leaves chats automatically based on this setting.',
        })}
      </p>

      <div className="rounded-xl bg-amber-500/10 ring-1 ring-amber-500/20 px-4 py-3 mb-5">
        <p className="text-sm text-amber-950 dark:text-amber-100">
          {t('admin.botRunnerHint', {
            defaultValue:
              'Important: for the bot to actually connect to Twitch chats, the backend chatbotRunner must be running as a persistent service.',
          })}
        </p>
      </div>

      <div className={`glass p-4 ${isBusy ? 'pointer-events-none opacity-60' : ''}`}>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="font-semibold text-gray-900 dark:text-white">
              {t('admin.botToggleTitle', { defaultValue: 'Chat bot' })}
            </div>
            <div className="text-sm text-gray-600 dark:text-gray-300 mt-1">
              {t('admin.botToggleHint', { defaultValue: 'When enabled, the runner will join your chat and can send messages.' })}
            </div>
          </div>
          <label className="relative inline-flex items-center cursor-pointer shrink-0">
            <input
              type="checkbox"
              checked={botEnabled ?? false}
              onChange={(e) => void callToggle(e.target.checked)}
              className="sr-only peer"
              disabled={botEnabled === null && isBusy}
            />
            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/20 dark:peer-focus:ring-primary/30 rounded-full peer dark:bg-gray-600 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-primary" />
          </label>
        </div>
        {botEnabled === null && (
          <div className="text-xs text-gray-500 dark:text-gray-400 mt-2">
            {t('admin.botStatusUnknown', { defaultValue: 'Status is unknown until you toggle it (or until the server provides it).' })}
          </div>
        )}
      </div>

      <div className="mt-6 pt-6 border-t border-black/5 dark:border-white/10">
        <h3 className="text-lg font-semibold mb-2 dark:text-white">
          {t('admin.botCommandsTitle', { defaultValue: 'Commands' })}
        </h3>
        <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
          {t('admin.botCommandsHint', {
            defaultValue: 'Create a trigger word and the bot reply. When someone sends the trigger in chat, the bot will respond.',
          })}
        </p>

        {!commandsApiAvailable && (
          <div className="rounded-xl bg-gray-500/10 ring-1 ring-black/10 dark:ring-white/10 px-4 py-3 mb-4">
            <p className="text-sm text-gray-800 dark:text-gray-200">
              {t('admin.botCommandsNotAvailable', {
                defaultValue: 'Commands are not available on this server yet. Please deploy the backend update.',
              })}
            </p>
          </div>
        )}

        <div className={`glass p-4 ${isBusy ? 'pointer-events-none opacity-60' : ''}`}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">
                {t('admin.botCommandTrigger', { defaultValue: 'Trigger' })}
              </div>
              <Input value={newTrigger} onChange={(e) => setNewTrigger(e.target.value)} placeholder="!hello" />
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">
                {t('admin.botCommandResponse', { defaultValue: 'Response' })}
              </div>
              <Input value={newResponse} onChange={(e) => setNewResponse(e.target.value)} placeholder="Hello chat!" />
            </div>
          </div>

          <div className="mt-3 flex gap-3">
            <Button type="button" variant="primary" onClick={() => void addCommand()} disabled={isBusy}>
              {t('admin.addBotCommand', { defaultValue: 'Add command' })}
            </Button>
            <Button type="button" variant="secondary" onClick={() => void loadCommands()} disabled={isBusy}>
              {t('common.retry', { defaultValue: 'Retry' })}
            </Button>
          </div>
        </div>

        <div className="mt-4 space-y-2">
          {commands.length === 0 ? (
            <div className="text-sm text-gray-500 dark:text-gray-400">
              {t('admin.noBotCommands', { defaultValue: 'No commands yet.' })}
            </div>
          ) : (
            commands.map((c) => (
              <div key={c.id} className="glass p-4 flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="font-semibold text-gray-900 dark:text-white break-words">
                    {c.trigger}
                  </div>
                  <div className="text-sm text-gray-600 dark:text-gray-300 mt-1 break-words">
                    {c.response}
                  </div>
                </div>
                <Button type="button" variant="danger" onClick={() => void deleteCommand(c.id)} disabled={isBusy}>
                  {t('common.delete', { defaultValue: 'Delete' })}
                </Button>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="mt-6 pt-6 border-t border-black/5 dark:border-white/10">
        <h3 className="text-lg font-semibold mb-2 dark:text-white">
          {t('admin.botTestMessageTitle', { defaultValue: 'Test message' })}
        </h3>
        <p className="text-sm text-gray-600 dark:text-gray-300 mb-3">
          {t('admin.botTestMessageHint', {
            defaultValue:
              'Send a message from the bot into your Twitch chat. This helps confirm the bot is connected and visible.',
          })}
        </p>

        <Textarea
          value={testMessage}
          onChange={(e) => setTestMessage(e.target.value)}
          rows={3}
          placeholder={defaultTestMessage}
          disabled={isBusy}
        />

        <div className="mt-3">
          <Button type="button" variant="primary" onClick={() => void sendTestMessage()} disabled={isBusy}>
            {t('admin.sendTestMessage', { defaultValue: 'Send test message' })}
          </Button>
        </div>
      </div>
    </div>
  );
}


