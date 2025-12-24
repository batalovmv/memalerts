import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  updatedAt?: string;
};

export function BotSettings() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState<'toggle' | 'load' | null>(null);
  const [botEnabled, setBotEnabled] = useState<boolean | null>(null);
  const [statusLoaded, setStatusLoaded] = useState(false);
  const [menusOpen, setMenusOpen] = useState(true);

  const [commands, setCommands] = useState<BotCommand[]>([]);
  const [commandsLoaded, setCommandsLoaded] = useState(false);
  const [commandsLoading, setCommandsLoading] = useState(false);
  const [commandsNotAvailable, setCommandsNotAvailable] = useState(false);
  const [newTrigger, setNewTrigger] = useState('');
  const [newResponse, setNewResponse] = useState('');

  const [testMessage, setTestMessage] = useState('');
  const [sendingTestMessage, setSendingTestMessage] = useState(false);

  const [followGreetingsEnabled, setFollowGreetingsEnabled] = useState<boolean>(false);
  const [followGreetingTemplate, setFollowGreetingTemplate] = useState<string>('');
  const [savingFollowGreetings, setSavingFollowGreetings] = useState(false);
  const followGreetingSaveTimerRef = useRef<number | null>(null);
  const followGreetingsEnableInFlightRef = useRef(false);

  const followGreetingsStorageKey = 'memalerts:bot:followGreetingsEnabled:v1';

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(followGreetingsStorageKey);
      const parsed = raw === '1' ? true : raw === '0' ? false : null;
      if (parsed !== null) setFollowGreetingsEnabled(parsed);
    } catch {
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadSubscription = async () => {
    try {
      setLoading('load');
      const { api } = await import('@/lib/api');
      const res = await api.get<{ enabled?: boolean | null }>('/streamer/bot/subscription', { timeout: 8000 });
      if (typeof res?.enabled === 'boolean') {
        setBotEnabled(res.enabled);
      } else {
        setBotEnabled(null);
      }
    } catch (error: unknown) {
      // If backend doesn't support it yet, keep optimistic UI (unknown until toggled).
      const apiError = error as { response?: { status?: number } };
      if (apiError.response?.status === 404) {
        setBotEnabled(null);
        return;
      }
      setBotEnabled(null);
      // Don't spam toast on initial page load; keep quiet unless user interacts.
    } finally {
      setStatusLoaded(true);
      setLoading(null);
    }
  };

  useEffect(() => {
    void loadSubscription();
  }, []);

  // UX: when the bot is enabled, auto-expand settings; when disabled, collapse.
  useEffect(() => {
    if (botEnabled === true) setMenusOpen(true);
    if (botEnabled === false) setMenusOpen(false);
  }, [botEnabled]);

  const loadCommands = useCallback(async () => {
    try {
      setCommandsLoading(true);
      const { api } = await import('@/lib/api');
      const res = await api.get<{ items?: BotCommand[] }>('/streamer/bot/commands', { timeout: 12000 });
      const items = Array.isArray(res?.items) ? res.items : [];
      setCommands(items);
      setCommandsNotAvailable(false);
      setCommandsLoaded(true);
    } catch (error: unknown) {
      const apiError = error as { response?: { status?: number } };
      if (apiError.response?.status === 404) {
        setCommandsNotAvailable(true);
        setCommandsLoaded(true);
        return;
      }
      setCommandsLoaded(false);
      toast.error(t('admin.failedToLoadBotCommands', { defaultValue: 'Failed to load commands.' }));
    } finally {
      setCommandsLoading(false);
    }
  }, [t]);

  const addCommand = useCallback(async () => {
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
    try {
      const { api } = await import('@/lib/api');
      const res = await api.post<BotCommand>('/streamer/bot/commands', { trigger, response });
      if (res && typeof res === 'object' && 'id' in res) {
        setCommands((prev) => [res as BotCommand, ...prev]);
      } else {
        void loadCommands();
      }
      setNewTrigger('');
      setNewResponse('');
      toast.success(t('admin.botCommandAdded', { defaultValue: 'Command added.' }));
    } catch (error: unknown) {
      const apiError = error as { response?: { status?: number; data?: { error?: string; errorCode?: string } } };
      if (apiError.response?.status === 404) {
        toast.error(
          t('admin.botCommandsNotAvailable', { defaultValue: 'Commands are not available on this server yet. Please deploy the backend update.' })
        );
        return;
      }
      const code = apiError.response?.data?.errorCode;
      if (apiError.response?.status === 409 || code === 'BOT_COMMAND_ALREADY_EXISTS') {
        toast.error(t('admin.botCommandAlreadyExists', { defaultValue: 'This trigger already exists.' }));
        return;
      }
      toast.error(apiError.response?.data?.error || t('admin.failedToAddBotCommand', { defaultValue: 'Failed to add command.' }));
    }
  }, [loadCommands, newResponse, newTrigger, t]);

  const deleteCommand = useCallback(
    async (id: string) => {
      try {
        const { api } = await import('@/lib/api');
        await api.delete(`/streamer/bot/commands/${encodeURIComponent(id)}`);
        setCommands((prev) => prev.filter((c) => c.id !== id));
        toast.success(t('admin.botCommandDeleted', { defaultValue: 'Command deleted.' }));
      } catch (error: unknown) {
        const apiError = error as { response?: { data?: { error?: string } } };
        toast.error(apiError.response?.data?.error || t('admin.failedToDeleteBotCommand', { defaultValue: 'Failed to delete command.' }));
      }
    },
    [t]
  );

  const enableFollowGreetings = useCallback(async () => {
    const startedAt = Date.now();
    try {
      setSavingFollowGreetings(true);
      followGreetingsEnableInFlightRef.current = true;
      const { api } = await import('@/lib/api');
      const res = await api.post<{ ok?: boolean; followGreetingsEnabled?: boolean; followGreetingTemplate?: string | null }>(
        '/streamer/bot/follow-greetings/enable',
        followGreetingTemplate.trim() ? { followGreetingTemplate: followGreetingTemplate.trim() } : {}
      );
      setFollowGreetingsEnabled(!!res?.followGreetingsEnabled);
      try {
        window.localStorage.setItem(followGreetingsStorageKey, res?.followGreetingsEnabled ? '1' : '0');
      } catch {
        // ignore
      }
      if (typeof res?.followGreetingTemplate === 'string') setFollowGreetingTemplate(res.followGreetingTemplate);
      toast.success(t('admin.followGreetingsEnabled', { defaultValue: 'Follow greetings enabled.' }));
    } catch (error: unknown) {
      const apiErr = error as { response?: { status?: number; data?: { error?: string; errorCode?: string } } };
      toast.error(apiErr.response?.data?.error || t('admin.failedToToggleFollowGreetings', { defaultValue: 'Failed to update follow greetings.' }));
    } finally {
      await ensureMinDuration(startedAt, 450);
      followGreetingsEnableInFlightRef.current = false;
      setSavingFollowGreetings(false);
    }
  }, [followGreetingTemplate, t]);

  const disableFollowGreetings = useCallback(async () => {
    const startedAt = Date.now();
    try {
      setSavingFollowGreetings(true);
      const { api } = await import('@/lib/api');
      const res = await api.post<{ ok?: boolean; followGreetingsEnabled?: boolean; followGreetingTemplate?: string | null }>(
        '/streamer/bot/follow-greetings/disable'
      );
      setFollowGreetingsEnabled(!!res?.followGreetingsEnabled);
      try {
        window.localStorage.setItem(followGreetingsStorageKey, res?.followGreetingsEnabled ? '1' : '0');
      } catch {
        // ignore
      }
      if (typeof res?.followGreetingTemplate === 'string') setFollowGreetingTemplate(res.followGreetingTemplate);
      toast.success(t('admin.followGreetingsDisabled', { defaultValue: 'Follow greetings disabled.' }));
    } catch (error: unknown) {
      const apiErr = error as { response?: { status?: number; data?: { error?: string; errorCode?: string } } };
      toast.error(apiErr.response?.data?.error || t('admin.failedToToggleFollowGreetings', { defaultValue: 'Failed to update follow greetings.' }));
    } finally {
      await ensureMinDuration(startedAt, 450);
      setSavingFollowGreetings(false);
    }
  }, [t]);

  const saveFollowGreetingTemplate = useCallback(
    async (nextTemplate: string) => {
      const startedAt = Date.now();
      try {
        setSavingFollowGreetings(true);
        const { api } = await import('@/lib/api');
        const res = await api.patch<{ ok?: boolean; followGreetingsEnabled?: boolean; followGreetingTemplate?: string | null }>(
          '/streamer/bot/follow-greetings',
          { followGreetingTemplate: nextTemplate || null }
        );
        // Keep UI in sync with backend-returned state.
        if (typeof res?.followGreetingsEnabled === 'boolean') setFollowGreetingsEnabled(res.followGreetingsEnabled);
        if (typeof res?.followGreetingTemplate === 'string') setFollowGreetingTemplate(res.followGreetingTemplate);
      } catch (error: unknown) {
        const apiErr = error as { response?: { status?: number; data?: { error?: string; errorCode?: string } } };
        toast.error(apiErr.response?.data?.error || t('admin.failedToSaveFollowGreetingTemplate', { defaultValue: 'Failed to save template.' }));
      } finally {
        await ensureMinDuration(startedAt, 450);
        setSavingFollowGreetings(false);
      }
    },
    [followGreetingsEnabled, t]
  );

  const sendTestMessage = useCallback(async () => {
    const msg = (testMessage || t('admin.botDefaultTestMessage', { defaultValue: 'Bot connected ✅' })).trim();
    if (!msg) {
      toast.error(t('admin.botTestMessageRequired', { defaultValue: 'Enter a message.' }));
      return;
    }
    const startedAt = Date.now();
    try {
      setSendingTestMessage(true);
      const { api } = await import('@/lib/api');
      await api.post('/streamer/bot/say', { message: msg });
      toast.success(t('admin.botTestMessageSent', { defaultValue: 'Message sent.' }));
    } catch (error: unknown) {
      const apiError = error as { response?: { status?: number; data?: { error?: string } } };
      if (apiError.response?.status === 404) {
        toast.error(t('admin.botCommandsNotAvailable', { defaultValue: 'This server does not support bot features yet.' }));
        return;
      }
      toast.error(apiError.response?.data?.error || t('admin.failedToSendBotTestMessage', { defaultValue: 'Failed to send message.' }));
    } finally {
      await ensureMinDuration(startedAt, 450);
      setSendingTestMessage(false);
    }
  }, [t, testMessage]);

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

  const isBusy = loading !== null;
  const showMenus = botEnabled === true;
  const menusDisabled = !showMenus || isBusy;

  const visibleCommands = useMemo(() => [...commands].sort((a, b) => a.trigger.localeCompare(b.trigger)), [commands]);

  useEffect(() => {
    if (!showMenus) return;
    if (!commandsLoaded && !commandsLoading) void loadCommands();
  }, [commandsLoaded, commandsLoading, loadCommands, showMenus]);

  // Debounced save of follow greeting template (while enabled).
  useEffect(() => {
    if (!showMenus) return;
    if (!followGreetingsEnabled) return;
    const trimmed = followGreetingTemplate.trim();
    // Avoid sending invalid empty template (backend returns 400), and avoid racing enable response.
    if (!trimmed) {
      return;
    }
    if (followGreetingsEnableInFlightRef.current) {
      return;
    }
    if (followGreetingSaveTimerRef.current) window.clearTimeout(followGreetingSaveTimerRef.current);
    followGreetingSaveTimerRef.current = window.setTimeout(() => {
      void saveFollowGreetingTemplate(trimmed);
    }, 600);
    return () => {
      if (followGreetingSaveTimerRef.current) window.clearTimeout(followGreetingSaveTimerRef.current);
      followGreetingSaveTimerRef.current = null;
    };
  }, [followGreetingTemplate, followGreetingsEnabled, saveFollowGreetingTemplate, showMenus]);

  return (
    <div className="surface p-6">
      <h2 className="text-2xl font-bold mb-2 dark:text-white">{t('admin.botTitle', { defaultValue: 'Bot' })}</h2>
      <p className="text-sm text-gray-600 dark:text-gray-300 mb-5">
        {t('admin.botDescription', {
          defaultValue:
            'Enable/disable the chat bot subscription for your channel. The bot joins/leaves chats automatically based on this setting.',
        })}
      </p>

      <div className={`glass p-4 ${isBusy ? 'pointer-events-none opacity-60' : ''}`}>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="font-semibold text-gray-900 dark:text-white">
              {t('admin.botToggleTitle', { defaultValue: 'Chat bot' })}
            </div>
            <div className="text-sm text-gray-600 dark:text-gray-300 mt-1">
              {t('admin.botToggleHint', { defaultValue: 'When enabled, the runner will join your chat.' })}
            </div>
          </div>
          <label className="relative inline-flex items-center cursor-pointer shrink-0">
            <input
              type="checkbox"
              checked={botEnabled ?? false}
              onChange={(e) => void callToggle(e.target.checked)}
              className="sr-only peer"
              disabled={isBusy || !statusLoaded}
            />
            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/20 dark:peer-focus:ring-primary/30 rounded-full peer dark:bg-gray-600 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-primary" />
          </label>
        </div>

        {!statusLoaded && (
          <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
            {loading === 'load'
              ? t('admin.botStatusLoading', { defaultValue: 'Loading status…' })
              : t('admin.botStatusUnknown', { defaultValue: 'Status is unknown.' })}
          </div>
        )}

        <div className="mt-4">
          <button
            type="button"
            className={`w-full flex items-center justify-between gap-3 rounded-lg px-3 py-2 transition-colors ${
              showMenus ? 'hover:bg-white/40 dark:hover:bg-white/5' : 'opacity-60 cursor-not-allowed'
            }`}
            disabled={!showMenus}
            onClick={() => setMenusOpen((v) => !v)}
          >
            <span className="text-sm font-semibold text-gray-900 dark:text-white">
              {t('admin.botMenusTitle', { defaultValue: 'Bot settings' })}
            </span>
            <svg
              className={`w-4 h-4 text-gray-600 dark:text-gray-300 transition-transform ${menusOpen ? 'rotate-180' : ''}`}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {showMenus && menusOpen && (
            <div className={`mt-3 space-y-4 ${menusDisabled ? 'pointer-events-none opacity-60' : ''}`}>
              {/* Follow greetings */}
              <div className="rounded-xl bg-white/40 dark:bg-white/5 ring-1 ring-black/5 dark:ring-white/10 p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="font-semibold text-gray-900 dark:text-white">
                      {t('admin.followGreetingsTitle', { defaultValue: 'Follow greetings' })}
                    </div>
                    <div className="text-sm text-gray-600 dark:text-gray-300 mt-1">
                      {t('admin.followGreetingsHint', { defaultValue: 'When someone follows your channel, the bot will post a greeting in chat.' })}
                    </div>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer shrink-0">
                    <input
                      type="checkbox"
                      checked={followGreetingsEnabled}
                      disabled={savingFollowGreetings}
                      onChange={(e) => {
                        const enabled = e.target.checked;
                        if (enabled) {
                          setFollowGreetingsEnabled(true);
                          void enableFollowGreetings();
                        } else {
                          setFollowGreetingsEnabled(false);
                          void disableFollowGreetings();
                        }
                      }}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/20 dark:peer-focus:ring-primary/30 rounded-full peer dark:bg-gray-600 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-primary" />
                  </label>
                </div>

                {followGreetingsEnabled && (
                  <div className="mt-3">
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                      {t('admin.followGreetingTemplateLabel', { defaultValue: 'Greeting template' })}
                    </label>
                    <Input
                      value={followGreetingTemplate}
                      onChange={(e) => setFollowGreetingTemplate(e.target.value)}
                      placeholder={t('admin.followGreetingTemplatePlaceholder', { defaultValue: 'Thanks for the follow, {user}!' })}
                    />
                    <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                      {t('admin.followGreetingTemplateVars', { defaultValue: 'You can use {user} placeholder.' })}
                    </div>
                  </div>
                )}
              </div>

              {/* Commands */}
              <div className="rounded-xl bg-white/40 dark:bg-white/5 ring-1 ring-black/5 dark:ring-white/10 p-4">
                <div className="font-semibold text-gray-900 dark:text-white">
                  {t('admin.botCommandsTitle', { defaultValue: 'Commands' })}
                </div>
                <div className="text-sm text-gray-600 dark:text-gray-300 mt-1">
                  {t('admin.botCommandsHint', {
                    defaultValue:
                      'Create a trigger word and the bot reply. When someone sends the trigger in chat, the bot will respond.',
                  })}
                </div>

                {commandsNotAvailable && (
                  <div className="mt-3 text-sm text-amber-800 dark:text-amber-200">
                    {t('admin.botCommandsNotAvailable', {
                      defaultValue: 'Commands are not available on this server yet. Please deploy the backend update.',
                    })}
                  </div>
                )}

                {!commandsNotAvailable && (
                  <>
                    <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-semibold text-gray-700 dark:text-gray-200 mb-1">
                          {t('admin.botCommandTrigger', { defaultValue: 'Trigger' })}
                        </label>
                        <Input value={newTrigger} onChange={(e) => setNewTrigger(e.target.value)} placeholder="!hello" />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-gray-700 dark:text-gray-200 mb-1">
                          {t('admin.botCommandResponse', { defaultValue: 'Response' })}
                        </label>
                        <Input value={newResponse} onChange={(e) => setNewResponse(e.target.value)} placeholder="Hi chat!" />
                      </div>
                    </div>

                    <div className="mt-3 flex items-center justify-between gap-3">
                      <Button type="button" variant="primary" onClick={() => void addCommand()} disabled={commandsLoading}>
                        {t('admin.addBotCommand', { defaultValue: 'Add command' })}
                      </Button>
                    </div>

                    <div className="mt-4">
                      {commandsLoading && (
                        <div className="text-xs text-gray-500 dark:text-gray-400">{t('common.loading', { defaultValue: 'Loading…' })}</div>
                      )}

                      {!commandsLoading && visibleCommands.length === 0 && (
                        <div className="text-sm text-gray-600 dark:text-gray-300">
                          {t('admin.noBotCommands', { defaultValue: 'No commands yet.' })}
                        </div>
                      )}

                      {!commandsLoading && visibleCommands.length > 0 && (
                        <div className="space-y-2">
                          {visibleCommands.map((cmd) => (
                            <div
                              key={cmd.id}
                              className="flex items-start justify-between gap-3 rounded-lg bg-white/50 dark:bg-white/5 ring-1 ring-black/5 dark:ring-white/10 px-3 py-2"
                            >
                              <div className="min-w-0">
                                <div className="font-mono text-sm text-gray-900 dark:text-white truncate">{cmd.trigger}</div>
                                <div className="text-sm text-gray-700 dark:text-gray-200 break-words">{cmd.response}</div>
                              </div>
                              <Button type="button" variant="secondary" onClick={() => void deleteCommand(cmd.id)}>
                                {t('common.delete', { defaultValue: 'Delete' })}
                              </Button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>

              {/* Test message */}
              <div className="rounded-xl bg-white/40 dark:bg-white/5 ring-1 ring-black/5 dark:ring-white/10 p-4">
                <div className="font-semibold text-gray-900 dark:text-white">
                  {t('admin.botTestMessageTitle', { defaultValue: 'Test message' })}
                </div>
                <div className="text-sm text-gray-600 dark:text-gray-300 mt-1">
                  {t('admin.botTestMessageHint', {
                    defaultValue:
                      'Send a message from the bot into your Twitch chat. This helps confirm the bot is connected and visible.',
                  })}
                </div>

                <div className="mt-3 space-y-3">
                  <Textarea
                    rows={2}
                    value={testMessage}
                    onChange={(e) => setTestMessage(e.target.value)}
                    placeholder={t('admin.botDefaultTestMessage', { defaultValue: 'Bot connected ✅' })}
                  />
                  <Button type="button" variant="primary" onClick={() => void sendTestMessage()} disabled={sendingTestMessage}>
                    {t('admin.sendTestMessage', { defaultValue: 'Send test message' })}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {!showMenus && (
            <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
              {t('admin.botMenusDisabledHint', { defaultValue: 'Enable the bot to access its settings.' })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


