import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { ensureMinDuration } from '@/shared/lib/ensureMinDuration';
import { useAppSelector } from '@/store/hooks';
import { Button, Input, Spinner, Textarea } from '@/shared/ui';
import { SavingOverlay } from '@/shared/ui/StatusOverlays';

type BotCommand = {
  id: string;
  trigger: string;
  response: string;
  enabled?: boolean;
  onlyWhenLive?: boolean;
  allowedRoles?: Array<'vip' | 'moderator' | 'subscriber' | 'follower'>;
  allowedUsers?: string[];
  createdAt?: string;
  updatedAt?: string;
};

type StreamDurationSettings = {
  enabled?: boolean;
  trigger?: string | null;
  responseTemplate?: string | null;
  breakCreditMinutes?: number | null;
  onlyWhenLive?: boolean | null;
};

type ToggleSwitchProps = {
  checked: boolean;
  disabled?: boolean;
  busy?: boolean;
  onChange: (next: boolean) => void;
  ariaLabel?: string;
};

function ToggleSwitch({ checked, disabled, busy, onChange, ariaLabel }: ToggleSwitchProps) {
  const isDisabled = !!disabled || !!busy;
  return (
    <label className={`relative inline-flex items-center cursor-pointer shrink-0 ${isDisabled ? 'opacity-80' : ''}`}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="sr-only peer"
        disabled={isDisabled}
        aria-label={ariaLabel}
      />
      <div
        className={[
          'relative w-11 h-6 rounded-full transition-colors',
          'bg-gray-200 dark:bg-gray-600',
          'peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/20 dark:peer-focus:ring-primary/30',
          'peer-checked:bg-primary',
        ].join(' ')}
      >
        <div
          className={[
            'absolute top-[2px] left-[2px] h-5 w-5 rounded-full bg-white border border-gray-300 dark:border-gray-600',
            'transition-transform',
            checked ? 'translate-x-full' : 'translate-x-0',
            busy ? 'grid place-items-center' : '',
          ].join(' ')}
        >
          {busy ? <Spinner className="h-3 w-3 border-[2px]" /> : null}
        </div>
      </div>
    </label>
  );
}

export function BotSettings() {
  const { t } = useTranslation();
  const { user } = useAppSelector((s) => s.auth);
  // Treat undefined as "unknown" (do not block). Block only when backend explicitly says null.
  const twitchLinked = user?.channel?.twitchChannelId !== null;
  const [loading, setLoading] = useState<'toggle' | 'load' | null>(null);
  const [botEnabled, setBotEnabled] = useState<boolean | null>(null);
  const [statusLoaded, setStatusLoaded] = useState(false);
  const [menusOpen, setMenusOpen] = useState(true);

  const [commands, setCommands] = useState<BotCommand[]>([]);
  const [commandsLoaded, setCommandsLoaded] = useState(false);
  const [commandsLoading, setCommandsLoading] = useState(false);
  const [commandsNotAvailable, setCommandsNotAvailable] = useState(false);
  const [commandToggleLoadingId, setCommandToggleLoadingId] = useState<string | null>(null);
  const [commandsOpen, setCommandsOpen] = useState<boolean>(false);
  const [newTrigger, setNewTrigger] = useState('');
  const [newResponse, setNewResponse] = useState('');
  const [commandsOnlyWhenLive, setCommandsOnlyWhenLive] = useState(false);
  const [newAllowedRoles, setNewAllowedRoles] = useState<Array<'vip' | 'moderator' | 'subscriber' | 'follower'>>([]);
  const [newAllowedUsers, setNewAllowedUsers] = useState('');
  const [savingCommandsBulk, setSavingCommandsBulk] = useState(false);
  const lastCommandsEnabledMapRef = useRef<Record<string, boolean> | null>(null);

  const [editingAudienceId, setEditingAudienceId] = useState<string | null>(null);
  const [audienceDraftRoles, setAudienceDraftRoles] = useState<Array<'vip' | 'moderator' | 'subscriber' | 'follower'>>([]);
  const [audienceDraftUsers, setAudienceDraftUsers] = useState<string>('');

  const [testMessage, setTestMessage] = useState('');
  const [sendingTestMessage, setSendingTestMessage] = useState(false);

  const [followGreetingsEnabled, setFollowGreetingsEnabled] = useState<boolean>(false);
  const [followGreetingTemplate, setFollowGreetingTemplate] = useState<string>('');
  const [savingFollowGreetings, setSavingFollowGreetings] = useState(false);
  const followGreetingSaveTimerRef = useRef<number | null>(null);
  const followGreetingsEnableInFlightRef = useRef(false);

  const [streamDurationLoaded, setStreamDurationLoaded] = useState(false);
  const [streamDurationNotAvailable, setStreamDurationNotAvailable] = useState(false);
  const [savingStreamDuration, setSavingStreamDuration] = useState(false);
  const [streamDurationEnabled, setStreamDurationEnabled] = useState(false);
  const [streamDurationTrigger, setStreamDurationTrigger] = useState('!time');
  const [streamDurationTemplate, setStreamDurationTemplate] = useState('');
  const [streamDurationBreakCreditMinutes, setStreamDurationBreakCreditMinutes] = useState<number>(60);
  const [streamDurationOpen, setStreamDurationOpen] = useState<boolean>(false);

  const loadFollowGreetings = useCallback(async () => {
    try {
      const { api } = await import('@/lib/api');
      const res = await api.get<{ followGreetingsEnabled?: boolean; followGreetingTemplate?: string | null }>(
        '/streamer/bot/follow-greetings',
        { timeout: 8000 }
      );
      if (typeof res?.followGreetingsEnabled === 'boolean') setFollowGreetingsEnabled(res.followGreetingsEnabled);
      if (typeof res?.followGreetingTemplate === 'string') setFollowGreetingTemplate(res.followGreetingTemplate);
    } catch (error: unknown) {
      const apiError = error as { response?: { status?: number } };
      // Backend may not support this endpoint yet.
      if (apiError.response?.status === 404) return;
      // Keep quiet on load; user will see errors on interaction if needed.
    }
  }, []);

  const loadStreamDuration = useCallback(async () => {
    try {
      const { api } = await import('@/lib/api');
      const res = await api.get<StreamDurationSettings>('/streamer/bot/stream-duration', { timeout: 8000 });

      if (typeof res?.enabled === 'boolean') setStreamDurationEnabled(res.enabled);
      if (typeof res?.trigger === 'string' && res.trigger.trim()) setStreamDurationTrigger(res.trigger);
      if (typeof res?.responseTemplate === 'string') setStreamDurationTemplate(res.responseTemplate);
      if (typeof res?.breakCreditMinutes === 'number' && Number.isFinite(res.breakCreditMinutes)) {
        setStreamDurationBreakCreditMinutes(Math.max(0, Math.round(res.breakCreditMinutes)));
      }

      if (typeof res?.enabled === 'boolean') setStreamDurationOpen(res.enabled);
      setStreamDurationNotAvailable(false);
      setStreamDurationLoaded(true);
    } catch (error: unknown) {
      const apiError = error as { response?: { status?: number } };
      if (apiError.response?.status === 404) {
        setStreamDurationNotAvailable(true);
        setStreamDurationLoaded(true);
        return;
      }
      // Keep quiet on load; user will see errors on interaction if needed.
      setStreamDurationLoaded(false);
    }
  }, []);

  const loadSubscription = useCallback(async () => {
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
  }, []);

  useEffect(() => {
    void loadSubscription();
    void loadFollowGreetings();
  }, [loadFollowGreetings, loadSubscription]);

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

  const normalizeUserList = useCallback((raw: string): string[] => {
    const items = raw
      .split(/[\s,;]+/g)
      .map((v) => v.trim())
      .filter(Boolean)
      .map((v) => v.replace(/^@/, '').toLowerCase());
    // de-dup
    return Array.from(new Set(items));
  }, []);

  const formatUserList = useCallback((users: string[] | undefined | null): string => {
    if (!Array.isArray(users) || users.length === 0) return '';
    return users.map((u) => u.trim()).filter(Boolean).join(', ');
  }, []);

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
      const allowedUsers = normalizeUserList(newAllowedUsers);
      const res = await api.post<BotCommand>('/streamer/bot/commands', {
        trigger,
        response,
        onlyWhenLive: commandsOnlyWhenLive,
        allowedRoles: newAllowedRoles,
        allowedUsers,
      });
      if (res && typeof res === 'object' && 'id' in res) {
        setCommands((prev) => [res as BotCommand, ...prev]);
      } else {
        void loadCommands();
      }
      setNewTrigger('');
      setNewResponse('');
      setNewAllowedRoles([]);
      setNewAllowedUsers('');
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
  }, [commandsOnlyWhenLive, loadCommands, newAllowedRoles, newAllowedUsers, newResponse, newTrigger, normalizeUserList, t]);

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

  const updateCommand = useCallback(
    async (id: string, patch: Partial<Pick<BotCommand, 'enabled' | 'onlyWhenLive' | 'allowedRoles' | 'allowedUsers'>>) => {
      const startedAt = Date.now();
      const prev = commands.find((c) => c.id === id) || null;
      try {
        setCommandToggleLoadingId(id);
        // Optimistic UI
        setCommands((list) => list.map((c) => (c.id === id ? { ...c, ...patch } : c)));

        const { api } = await import('@/lib/api');
        const res = await api.patch<BotCommand>(`/streamer/bot/commands/${encodeURIComponent(id)}`, patch);
        // Keep UI consistent with backend (in case it normalizes fields).
        if (res && typeof res === 'object' && 'id' in res) {
          const updated = res as BotCommand;
          setCommands((prev) => prev.map((c) => (c.id === id ? { ...c, ...updated } : c)));
        }
      } catch (error: unknown) {
        // Revert optimistic update on failure.
        if (prev) {
          setCommands((list) => list.map((c) => (c.id === id ? { ...c, ...prev } : c)));
        }
        const apiErr = error as { response?: { status?: number; data?: { error?: string } } };
        if (apiErr.response?.status === 400) {
          toast.error(apiErr.response?.data?.error || t('admin.failedToToggleBotCommand', { defaultValue: 'Failed to update command.' }));
          return;
        }
        if (apiErr.response?.status === 404) {
          toast.error(
            t('admin.botCommandsToggleNotAvailable', {
              defaultValue: 'Command not found (or bot commands are not available on this server yet).',
            })
          );
          return;
        }
        toast.error(apiErr.response?.data?.error || t('admin.failedToToggleBotCommand', { defaultValue: 'Failed to update command.' }));
      } finally {
        await ensureMinDuration(startedAt, 450);
        setCommandToggleLoadingId(null);
      }
    },
    [commands, t]
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
    [t]
  );

  const saveStreamDuration = useCallback(async (override?: { enabled?: boolean }) => {
    const startedAt = Date.now();
    const trigger = streamDurationTrigger.trim();
    const responseTemplate = streamDurationTemplate.trim();
    const breakCreditMinutes = Number.isFinite(streamDurationBreakCreditMinutes)
      ? Math.max(0, Math.round(streamDurationBreakCreditMinutes))
      : 0;

    const enabledToSave = typeof override?.enabled === 'boolean' ? override.enabled : streamDurationEnabled;

    if (!trigger) {
      toast.error(t('admin.streamDurationTriggerRequired', { defaultValue: 'Enter a trigger.' }));
      return;
    }

    try {
      setSavingStreamDuration(true);
      const { api } = await import('@/lib/api');
      const res = await api.patch<StreamDurationSettings>('/streamer/bot/stream-duration', {
        enabled: enabledToSave,
        trigger,
        responseTemplate: responseTemplate || null,
        breakCreditMinutes,
        // This command only makes sense while the stream is live, so we force live-only.
        onlyWhenLive: true,
      });

      if (typeof res?.enabled === 'boolean') setStreamDurationEnabled(res.enabled);
      if (typeof res?.trigger === 'string' && res.trigger.trim()) setStreamDurationTrigger(res.trigger);
      if (typeof res?.responseTemplate === 'string') setStreamDurationTemplate(res.responseTemplate);
      if (typeof res?.breakCreditMinutes === 'number' && Number.isFinite(res.breakCreditMinutes)) {
        setStreamDurationBreakCreditMinutes(Math.max(0, Math.round(res.breakCreditMinutes)));
      }

      toast.success(t('admin.streamDurationSaved', { defaultValue: 'Saved.' }));
    } catch (error: unknown) {
      const apiErr = error as { response?: { status?: number; data?: { error?: string } } };
      if (apiErr.response?.status === 404) {
        toast.error(
          t('admin.streamDurationNotAvailable', {
            defaultValue: 'Stream duration command is not available on this server yet. Please deploy the backend update.',
          })
        );
        return;
      }
      toast.error(apiErr.response?.data?.error || t('admin.failedToSaveStreamDuration', { defaultValue: 'Failed to save.' }));
    } finally {
      await ensureMinDuration(startedAt, 450);
      setSavingStreamDuration(false);
    }
  }, [streamDurationBreakCreditMinutes, streamDurationEnabled, streamDurationTemplate, streamDurationTrigger, t]);

  const toggleStreamDurationEnabled = useCallback(
    async (nextEnabled: boolean) => {
      setStreamDurationEnabled(nextEnabled);
      setStreamDurationOpen(nextEnabled);
      // Persist immediately (so the toggle actually works without pressing "Save").
      // Uses current form values; backend can validate/normalize.
      void saveStreamDuration({ enabled: nextEnabled });
    },
    [saveStreamDuration]
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
      if (!twitchLinked) {
        toast.error(t('admin.twitchChannelNotLinked', { defaultValue: 'This channel is not linked to Twitch.' }));
        return;
      }
      setLoading('toggle');
      const { api } = await import('@/lib/api');
      await api.post(nextEnabled ? '/streamer/bot/enable' : '/streamer/bot/disable');
      setBotEnabled(nextEnabled);
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

  const visibleCommands = useMemo(() => [...commands].sort((a, b) => a.trigger.localeCompare(b.trigger)), [commands]);
  const anyCommandEnabled = useMemo(() => visibleCommands.some((c) => c.enabled !== false), [visibleCommands]);
  const allCommandsLiveOnly = useMemo(() => {
    if (visibleCommands.length === 0) return false;
    return visibleCommands.every((c) => c.onlyWhenLive === true);
  }, [visibleCommands]);

  useEffect(() => {
    if (!showMenus) return;
    if (!commandsLoaded && !commandsLoading) void loadCommands();
  }, [commandsLoaded, commandsLoading, loadCommands, showMenus]);

  // UX: collapse commands panel when all commands are disabled; expand when any is enabled.
  useEffect(() => {
    if (!showMenus) return;
    if (!commandsLoaded) return;
    setCommandsOpen(anyCommandEnabled);
  }, [anyCommandEnabled, commandsLoaded, showMenus]);

  // Initialize global live-only toggle from current commands (best-effort).
  useEffect(() => {
    if (!showMenus) return;
    if (!commandsLoaded) return;
    setCommandsOnlyWhenLive(allCommandsLiveOnly);
  }, [allCommandsLiveOnly, commandsLoaded, showMenus]);

  useEffect(() => {
    if (!showMenus) return;
    if (streamDurationLoaded || streamDurationNotAvailable) return;
    void loadStreamDuration();
  }, [loadStreamDuration, showMenus, streamDurationLoaded, streamDurationNotAvailable]);

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

      <div className={`glass p-4 relative ${isBusy ? 'pointer-events-none opacity-60' : ''}`}>
        {loading === 'toggle' ? <SavingOverlay label={t('admin.saving', { defaultValue: 'Saving…' })} /> : null}
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="font-semibold text-gray-900 dark:text-white">
              {t('admin.botToggleTitle', { defaultValue: 'Chat bot' })}
            </div>
            <div className="text-sm text-gray-600 dark:text-gray-300 mt-1">
              {t('admin.botToggleHint', { defaultValue: 'When enabled, the runner will join your chat.' })}
            </div>
          </div>
          <ToggleSwitch
            checked={botEnabled ?? false}
            onChange={(next) => void callToggle(next)}
            disabled={isBusy || !statusLoaded || !twitchLinked}
            busy={loading === 'toggle'}
            ariaLabel={t('admin.botToggleTitle', { defaultValue: 'Chat bot' })}
          />
        </div>

        {!twitchLinked && (
          <div className="mt-2 text-xs text-yellow-700 dark:text-yellow-300">
            {t('admin.twitchChannelNotLinked', { defaultValue: 'This channel is not linked to Twitch.' })}
          </div>
        )}

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
              <div className="rounded-xl bg-white/40 dark:bg-white/5 ring-1 ring-black/5 dark:ring-white/10 p-4 relative">
                {savingFollowGreetings ? <SavingOverlay label={t('admin.saving', { defaultValue: 'Saving…' })} /> : null}
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="font-semibold text-gray-900 dark:text-white">
                      {t('admin.followGreetingsTitle', { defaultValue: 'Follow greetings' })}
                    </div>
                    <div className="text-sm text-gray-600 dark:text-gray-300 mt-1">
                      {t('admin.followGreetingsHint', {
                        defaultValue: 'When someone follows your channel (while you are live), the bot will post a greeting in chat.',
                      })}
                    </div>
                  </div>
                  <ToggleSwitch
                    checked={followGreetingsEnabled}
                    disabled={savingFollowGreetings}
                    busy={savingFollowGreetings}
                    onChange={(enabled) => {
                      if (enabled) {
                        setFollowGreetingsEnabled(true);
                        void enableFollowGreetings();
                      } else {
                        setFollowGreetingsEnabled(false);
                        void disableFollowGreetings();
                      }
                    }}
                    ariaLabel={t('admin.followGreetingsTitle', { defaultValue: 'Follow greetings' })}
                  />
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

              {/* Stream duration command */}
              <div className="rounded-xl bg-white/40 dark:bg-white/5 ring-1 ring-black/5 dark:ring-white/10 p-4 relative">
                {savingStreamDuration ? <SavingOverlay label={t('admin.saving', { defaultValue: 'Saving…' })} /> : null}
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="font-semibold text-gray-900 dark:text-white">
                      {t('admin.streamDurationTitle', { defaultValue: 'Stream duration command' })}
                    </div>
                    <div className="text-sm text-gray-600 dark:text-gray-300 mt-1">
                      {t('admin.streamDurationHint', {
                        defaultValue:
                          'Bot command that tracks how long your stream has been live. Optional “break credit” keeps the timer running during short interruptions.',
                      })}
                    </div>
                  </div>
                  <ToggleSwitch
                    checked={streamDurationEnabled}
                    disabled={savingStreamDuration || streamDurationNotAvailable}
                    busy={savingStreamDuration}
                    onChange={(enabled) => void toggleStreamDurationEnabled(enabled)}
                    ariaLabel={t('admin.streamDurationTitle', { defaultValue: 'Stream duration command' })}
                  />
                </div>

                {streamDurationNotAvailable && (
                  <div className="mt-3 text-sm text-amber-800 dark:text-amber-200">
                    {t('admin.streamDurationNotAvailable', {
                      defaultValue:
                        'Stream duration command is not available on this server yet. Please deploy the backend update.',
                    })}
                  </div>
                )}

                {!streamDurationNotAvailable && streamDurationEnabled && streamDurationOpen && (
                  <div className="mt-3 space-y-3">
                    <div className="text-xs text-gray-600 dark:text-gray-300">
                      {t('admin.streamDurationLiveOnlyInfo', {
                        defaultValue: 'This command works only while your Twitch stream is live.',
                      })}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-semibold text-gray-700 dark:text-gray-200 mb-1">
                          {t('admin.streamDurationTriggerLabel', { defaultValue: 'Trigger' })}
                        </label>
                        <Input
                          value={streamDurationTrigger}
                          onChange={(e) => setStreamDurationTrigger(e.target.value)}
                          placeholder="!time"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-gray-700 dark:text-gray-200 mb-1">
                          {t('admin.streamDurationBreakCreditLabel', { defaultValue: 'Break credit (minutes)' })}
                        </label>
                        <Input
                          type="number"
                          min={0}
                          step={1}
                          value={String(streamDurationBreakCreditMinutes)}
                          onChange={(e) => {
                            const n = Number(e.target.value);
                            setStreamDurationBreakCreditMinutes(Number.isFinite(n) ? n : 0);
                          }}
                        />
                        <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                          {t('admin.streamDurationBreakCreditHint', {
                            defaultValue:
                              'If the stream goes offline briefly (e.g. 30 min) and credit is 60 min, the timer won’t reset.',
                          })}
                        </div>
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-gray-700 dark:text-gray-200 mb-1">
                        {t('admin.streamDurationTemplateLabel', { defaultValue: 'Response template' })}
                      </label>
                      <Input
                        value={streamDurationTemplate}
                        onChange={(e) => setStreamDurationTemplate(e.target.value)}
                        placeholder={t('admin.streamDurationTemplatePlaceholder', { defaultValue: 'Live for {hours}h {minutes}m' })}
                      />
                      <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                        {t('admin.streamDurationTemplateVars', {
                          defaultValue: 'Variables: {hours}, {minutes}, {totalMinutes}.',
                        })}
                      </div>
                    </div>

                    <div className="flex items-center justify-end gap-3">
                      <Button type="button" variant="primary" onClick={() => void saveStreamDuration()} disabled={savingStreamDuration}>
                        {t('common.save', { defaultValue: 'Save' })}
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              {/* Commands */}
              <div className="rounded-xl bg-white/40 dark:bg-white/5 ring-1 ring-black/5 dark:ring-white/10 p-4 relative">
                {savingCommandsBulk ? <SavingOverlay label={t('admin.saving', { defaultValue: 'Saving…' })} /> : null}
                <div className="flex items-start justify-between gap-4">
                  <button
                    type="button"
                    className={`min-w-0 text-left rounded-lg -m-1 p-1 transition-colors ${
                      showMenus ? 'hover:bg-white/40 dark:hover:bg-white/5' : 'opacity-60 cursor-not-allowed'
                    }`}
                    disabled={!showMenus}
                    onClick={() => setCommandsOpen((v) => !v)}
                  >
                    <div className="font-semibold text-gray-900 dark:text-white">
                      {t('admin.botCommandsTitle', { defaultValue: 'Commands' })}
                    </div>
                    <div className="text-sm text-gray-600 dark:text-gray-300 mt-1">
                      {t('admin.botCommandsHint', {
                        defaultValue:
                          'Create a trigger word and the bot reply. When someone sends the trigger in chat, the bot will respond.',
                      })}
                    </div>
                  </button>

                  {/* Master toggle (moved into the Commands header; preserves per-command settings). */}
                  <div className="flex items-center gap-3 shrink-0">
                    <svg
                      className={`w-4 h-4 text-gray-600 dark:text-gray-300 transition-transform ${commandsOpen ? 'rotate-180' : ''}`}
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      aria-hidden="true"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                    <ToggleSwitch
                      checked={anyCommandEnabled}
                      disabled={savingCommandsBulk || commandToggleLoadingId !== null || commandsLoading || commandsNotAvailable}
                      busy={savingCommandsBulk}
                      onChange={async (next) => {
                        setCommandsOpen(next);
                      const startedAt = Date.now();
                      try {
                        setSavingCommandsBulk(true);

                        // Remember previous per-command enabled flags so we can restore on re-enable.
                        if (!next) {
                          lastCommandsEnabledMapRef.current = Object.fromEntries(
                            commands.map((c) => [c.id, c.enabled !== false])
                          );
                          for (const c of commands) {
                            if (c.enabled !== false) {
                              await updateCommand(c.id, { enabled: false });
                            }
                          }
                          return;
                        }

                        // Restore previous states if we have them; otherwise enable all.
                        const map = lastCommandsEnabledMapRef.current;
                        if (!map) {
                          for (const c of commands) {
                            await updateCommand(c.id, { enabled: true });
                          }
                          return;
                        }

                        for (const c of commands) {
                          const prevEnabled = map[c.id];
                          if (prevEnabled === true) {
                            await updateCommand(c.id, { enabled: true });
                          }
                        }
                      } finally {
                        await ensureMinDuration(startedAt, 450);
                        setSavingCommandsBulk(false);
                      }
                      }}
                      ariaLabel={t('admin.botCommandsMasterTitle', { defaultValue: 'Commands enabled' })}
                    />
                  </div>
                </div>

                {commandsNotAvailable && (
                  <div className="mt-3 text-sm text-amber-800 dark:text-amber-200">
                    {t('admin.botCommandsNotAvailable', {
                      defaultValue: 'Commands are not available on this server yet. Please deploy the backend update.',
                    })}
                  </div>
                )}

                {!commandsNotAvailable && commandsOpen && (
                  <>
                    <div className="mt-3 flex items-start justify-between gap-4 rounded-lg bg-white/40 dark:bg-white/5 ring-1 ring-black/5 dark:ring-white/10 px-3 py-2">
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-gray-700 dark:text-gray-200">
                          {t('admin.botCommandsOnlyWhenLiveTitle', { defaultValue: 'Active only when stream is live' })}
                        </div>
                        <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                          {t('admin.botCommandsOnlyWhenLiveHint', {
                            defaultValue: 'If enabled, all bot commands reply only while your stream is online.',
                          })}
                        </div>
                      </div>
                      <ToggleSwitch
                        checked={commandsOnlyWhenLive}
                        onChange={async (next) => {
                          const startedAt = Date.now();
                          try {
                            setSavingCommandsBulk(true);
                            setCommandsOnlyWhenLive(next);
                            // Apply to all commands.
                            for (const c of commands) {
                              if ((c.onlyWhenLive === true) !== next) {
                                await updateCommand(c.id, { onlyWhenLive: next });
                              }
                            }
                          } finally {
                            await ensureMinDuration(startedAt, 450);
                            setSavingCommandsBulk(false);
                          }
                        }}
                        disabled={commandsLoading || savingCommandsBulk || commandToggleLoadingId !== null || visibleCommands.length === 0}
                        busy={savingCommandsBulk}
                        ariaLabel={t('admin.botCommandsOnlyWhenLiveTitle', { defaultValue: 'Active only when stream is live' })}
                      />
                    </div>

                    <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-semibold text-gray-700 dark:text-gray-200 mb-1">
                          {t('admin.botCommandTrigger', { defaultValue: 'Trigger' })}
                        </label>
                        <Input
                          value={newTrigger}
                          onChange={(e) => setNewTrigger(e.target.value)}
                          placeholder="!hello"
                          disabled={commandsLoading}
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-gray-700 dark:text-gray-200 mb-1">
                          {t('admin.botCommandResponse', { defaultValue: 'Response' })}
                        </label>
                        <Input
                          value={newResponse}
                          onChange={(e) => setNewResponse(e.target.value)}
                          placeholder="Hi chat!"
                          disabled={commandsLoading}
                        />
                      </div>
                    </div>

                    <div className="mt-3 rounded-lg bg-white/40 dark:bg-white/5 ring-1 ring-black/5 dark:ring-white/10 px-3 py-2">
                      <div className="text-xs font-semibold text-gray-700 dark:text-gray-200">
                        {t('admin.botCommandAudienceTitle', { defaultValue: 'Who can trigger' })}
                      </div>
                      <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                        {t('admin.botCommandAudienceHint', {
                          defaultValue:
                            'Choose roles and/or specific users. Leave empty to allow everyone. Note: the broadcaster (streamer) may always be allowed to run commands even if their role is not selected.',
                        })}
                      </div>

                      <div className="mt-2 flex flex-wrap gap-3">
                        {(['vip', 'moderator', 'subscriber', 'follower'] as const).map((role) => {
                          const checked = newAllowedRoles.includes(role);
                          return (
                            <label key={role} className="inline-flex items-center gap-2 text-xs text-gray-700 dark:text-gray-200">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) => {
                                  const next = e.target.checked;
                                  setNewAllowedRoles((prev) => (next ? [...prev, role] : prev.filter((r) => r !== role)));
                                }}
                                disabled={commandsLoading}
                              />
                              <span>
                                {t(`admin.botRole_${role}`, {
                                  defaultValue:
                                    role === 'vip'
                                      ? 'VIP'
                                      : role === 'moderator'
                                        ? 'Moderators'
                                        : role === 'subscriber'
                                          ? 'Subscribers'
                                          : 'Followers',
                                })}
                              </span>
                            </label>
                          );
                        })}
                      </div>

                      <div className="mt-2">
                        <label className="block text-xs font-semibold text-gray-700 dark:text-gray-200 mb-1">
                          {t('admin.botCommandAudienceUsersLabel', { defaultValue: 'Specific users (logins)' })}
                        </label>
                        <Input
                          value={newAllowedUsers}
                          onChange={(e) => setNewAllowedUsers(e.target.value)}
                          placeholder={t('admin.botCommandAudienceUsersPlaceholder', { defaultValue: 'e.g. lotas_bro, someuser' })}
                          disabled={commandsLoading}
                        />
                        <div className="mt-1 text-[11px] text-gray-600 dark:text-gray-300">
                          {t('admin.botCommandAudienceUsersHint', {
                            defaultValue: 'Comma/space separated. “@” is allowed.',
                          })}
                        </div>
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
                              className="flex items-start justify-between gap-3 rounded-lg bg-white/50 dark:bg-white/5 ring-1 ring-black/5 dark:ring-white/10 px-3 py-2 relative"
                            >
                              {commandToggleLoadingId === cmd.id ? (
                                <SavingOverlay label={t('admin.saving', { defaultValue: 'Saving…' })} />
                              ) : null}
                              <div className="min-w-0">
                                <div className="font-mono text-sm text-gray-900 dark:text-white truncate">{cmd.trigger}</div>
                                <div className="text-sm text-gray-700 dark:text-gray-200 break-words">{cmd.response}</div>
                                <div className="mt-1 text-[11px] text-gray-600 dark:text-gray-300">
                                  {t('admin.botCommandAudienceSummary', { defaultValue: 'Audience' })}:{' '}
                                  {(() => {
                                    const roles = Array.isArray(cmd.allowedRoles) ? cmd.allowedRoles : [];
                                    const users = Array.isArray(cmd.allowedUsers) ? cmd.allowedUsers : [];
                                    if (roles.length === 0 && users.length === 0) {
                                      return t('admin.botCommandAudienceEveryone', { defaultValue: 'Everyone' });
                                    }
                                    const parts: string[] = [];
                                    if (roles.length) {
                                      parts.push(
                                        roles
                                          .map((r) =>
                                            t(`admin.botRole_${r}`, {
                                              defaultValue:
                                                r === 'vip'
                                                  ? 'VIP'
                                                  : r === 'moderator'
                                                    ? 'Moderators'
                                                    : r === 'subscriber'
                                                      ? 'Subscribers'
                                                      : 'Followers',
                                            })
                                          )
                                          .join(', ')
                                      );
                                    }
                                    if (users.length) {
                                      parts.push(users.map((u) => `@${u}`).join(', '));
                                    }
                                    return parts.join(' • ');
                                  })()}
                                </div>

                                <div className="mt-2">
                                  <Button
                                    type="button"
                                    variant="secondary"
                                    onClick={() => {
                                      if (editingAudienceId === cmd.id) {
                                        setEditingAudienceId(null);
                                        return;
                                      }
                                      setEditingAudienceId(cmd.id);
                                      setAudienceDraftRoles(Array.isArray(cmd.allowedRoles) ? cmd.allowedRoles : []);
                                      setAudienceDraftUsers(formatUserList(cmd.allowedUsers));
                                    }}
                                    disabled={commandToggleLoadingId === cmd.id || savingCommandsBulk}
                                  >
                                    {editingAudienceId === cmd.id
                                      ? t('common.close', { defaultValue: 'Close' })
                                      : t('admin.editAudience', { defaultValue: 'Audience' })}
                                  </Button>
                                </div>

                                {editingAudienceId === cmd.id && (
                                  <div className="mt-2 rounded-lg bg-white/40 dark:bg-white/5 ring-1 ring-black/5 dark:ring-white/10 px-3 py-2">
                                    <div className="text-xs font-semibold text-gray-700 dark:text-gray-200">
                                      {t('admin.botCommandAudienceTitle', { defaultValue: 'Who can trigger' })}
                                    </div>
                                    <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                                      {t('admin.botCommandAudienceHint', {
                                            defaultValue:
                                              'Choose roles and/or specific users. Leave empty to allow everyone. Note: the broadcaster (streamer) may always be allowed to run commands even if their role is not selected.',
                                      })}
                                    </div>

                                    <div className="mt-2 flex flex-wrap gap-3">
                                      {(['vip', 'moderator', 'subscriber', 'follower'] as const).map((role) => {
                                        const checked = audienceDraftRoles.includes(role);
                                        return (
                                          <label key={role} className="inline-flex items-center gap-2 text-xs text-gray-700 dark:text-gray-200">
                                            <input
                                              type="checkbox"
                                              checked={checked}
                                              onChange={(e) => {
                                                const next = e.target.checked;
                                                setAudienceDraftRoles((prev) =>
                                                  next ? [...prev, role] : prev.filter((r) => r !== role)
                                                );
                                              }}
                                              disabled={commandToggleLoadingId === cmd.id}
                                            />
                                            <span>
                                              {t(`admin.botRole_${role}`, {
                                                defaultValue:
                                                  role === 'vip'
                                                    ? 'VIP'
                                                    : role === 'moderator'
                                                      ? 'Moderators'
                                                      : role === 'subscriber'
                                                        ? 'Subscribers'
                                                        : 'Followers',
                                              })}
                                            </span>
                                          </label>
                                        );
                                      })}
                                    </div>

                                    <div className="mt-2">
                                      <label className="block text-xs font-semibold text-gray-700 dark:text-gray-200 mb-1">
                                        {t('admin.botCommandAudienceUsersLabel', { defaultValue: 'Specific users (logins)' })}
                                      </label>
                                      <Input
                                        value={audienceDraftUsers}
                                        onChange={(e) => setAudienceDraftUsers(e.target.value)}
                                        placeholder={t('admin.botCommandAudienceUsersPlaceholder', { defaultValue: 'e.g. lotas_bro, someuser' })}
                                        disabled={commandToggleLoadingId === cmd.id}
                                      />
                                      <div className="mt-1 text-[11px] text-gray-600 dark:text-gray-300">
                                        {t('admin.botCommandAudienceUsersHint', { defaultValue: 'Comma/space separated. “@” is allowed.' })}
                                      </div>
                                    </div>

                                    <div className="mt-3 flex items-center justify-end gap-2">
                                      <Button
                                        type="button"
                                        variant="secondary"
                                        onClick={() => {
                                          setEditingAudienceId(null);
                                          setAudienceDraftRoles([]);
                                          setAudienceDraftUsers('');
                                        }}
                                        disabled={commandToggleLoadingId === cmd.id}
                                      >
                                        {t('common.cancel', { defaultValue: 'Cancel' })}
                                      </Button>
                                      <Button
                                        type="button"
                                        variant="primary"
                                        onClick={() => {
                                          const allowedUsers = normalizeUserList(audienceDraftUsers);
                                          void updateCommand(cmd.id, { allowedRoles: audienceDraftRoles, allowedUsers });
                                        }}
                                        disabled={commandToggleLoadingId === cmd.id}
                                      >
                                        {t('common.save', { defaultValue: 'Save' })}
                                      </Button>
                                    </div>
                                  </div>
                                )}
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                <div className="flex flex-col items-end gap-1">
                                  <div className="flex items-center gap-2">
                                    <div className="text-[10px] text-gray-600 dark:text-gray-300 whitespace-nowrap">
                                      {t('admin.botCommandEnabledLabel', { defaultValue: 'Enabled' })}
                                    </div>
                                    <ToggleSwitch
                                      checked={cmd.enabled !== false}
                                      disabled={commandToggleLoadingId !== null || savingCommandsBulk}
                                      busy={commandToggleLoadingId === cmd.id}
                                      onChange={(next) => void updateCommand(cmd.id, { enabled: next })}
                                      ariaLabel={t('admin.botCommandEnabledLabel', { defaultValue: 'Enabled' })}
                                    />
                                  </div>
                                </div>
                                <Button
                                  type="button"
                                  variant="secondary"
                                  onClick={() => void deleteCommand(cmd.id)}
                                  disabled={commandToggleLoadingId === cmd.id}
                                >
                                  {t('common.delete', { defaultValue: 'Delete' })}
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </>
                )}

                {!commandsNotAvailable && !commandsOpen && (
                  <div className="mt-3 text-sm text-gray-600 dark:text-gray-300">
                    {t('admin.botCommandsDisabledHint', { defaultValue: 'Enable commands to manage triggers and replies.' })}
                  </div>
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


