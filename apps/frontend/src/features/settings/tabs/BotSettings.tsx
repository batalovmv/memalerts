import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { ensureMinDuration } from '@/shared/lib/ensureMinDuration';
import { useAppSelector } from '@/store/hooks';
import { Button, Input, Spinner, Textarea } from '@/shared/ui';
import { SavingOverlay } from '@/shared/ui/StatusOverlays';
import { linkExternalAccount } from '@/shared/auth/login';
import ConfirmDialog from '@/components/ConfirmDialog';

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

type StreamerBotIntegration = {
  provider: 'twitch' | 'youtube' | 'vkvideo' | string;
  enabled?: boolean;
  updatedAt?: string | null;
  // Optional config fields (provider-specific).
  vkvideoChannelId?: string | null;
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

  const [botTab, setBotTab] = useState<'twitch' | 'youtube' | 'vk'>('twitch');
  const [loading, setLoading] = useState<'toggle' | 'load' | null>(null);
  const [botEnabled, setBotEnabled] = useState<boolean | null>(null);
  const [statusLoaded, setStatusLoaded] = useState(false);
  const [menusOpen, setMenusOpen] = useState(true);

  const [botsLoaded, setBotsLoaded] = useState(false);
  const [botsLoading, setBotsLoading] = useState(false);
  const [bots, setBots] = useState<StreamerBotIntegration[]>([]);
  const [botIntegrationToggleLoading, setBotIntegrationToggleLoading] = useState<string | null>(null);
  const [youtubeNeedsRelink, setYoutubeNeedsRelink] = useState(false);
  const [youtubeEnableRetryQueued, setYoutubeEnableRetryQueued] = useState(false);
  const [youtubeRelinkModalOpen, setYoutubeRelinkModalOpen] = useState(false);
  const [youtubeForceRelinkLoading, setYoutubeForceRelinkLoading] = useState(false);
  const [youtubeLastRelinkErrorId, setYoutubeLastRelinkErrorId] = useState<string | null>(null);
  const [vkvideoNotAvailable, setVkvideoNotAvailable] = useState(false);
  const [vkvideoChannelId, setVkvideoChannelId] = useState('');
  const [vkvideoEnableMode, setVkvideoEnableMode] = useState<'auto' | 'manual'>('auto');
  const [vkvideoChannels, setVkvideoChannels] = useState<string[] | null>(null);
  const [vkvideoSelectedChannel, setVkvideoSelectedChannel] = useState<string>('');

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
  const [testMessageProvider, setTestMessageProvider] = useState<'twitch' | 'youtube' | 'vkvideo'>('twitch');
  const [lastOutbox, setLastOutbox] = useState<null | { provider: string; id?: string; status?: string; createdAt?: string }>(null);

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

  const loadBotIntegrations = useCallback(async () => {
    try {
      setBotsLoading(true);
      const { api } = await import('@/lib/api');
      const res = await api.get<{ items?: StreamerBotIntegration[] }>('/streamer/bots', { timeout: 8000 });
      const items = Array.isArray(res?.items) ? res.items : [];
      setBots(items);
      // If backend now reports YouTube enabled (or integrations were refreshed), clear relink flag.
      const yt = items.find((b) => b.provider === 'youtube');
      if (yt?.enabled === true) setYoutubeNeedsRelink(false);

      // Seed VKVideo channel id from backend if present.
      const vk = items.find((b) => b.provider === 'vkvideo');
      if (vk && typeof vk.vkvideoChannelId === 'string' && vk.vkvideoChannelId.trim()) {
        setVkvideoChannelId(vk.vkvideoChannelId.trim());
      }

      setBotsLoaded(true);
    } catch (error: unknown) {
      // Keep quiet on load; the rest of the page works without it.
      setBotsLoaded(false);
    } finally {
      setBotsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSubscription();
    void loadBotIntegrations();
    void loadFollowGreetings();
  }, [loadBotIntegrations, loadFollowGreetings, loadSubscription]);

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
      const res = await api.post<{
        ok?: boolean;
        provider?: string;
        outbox?: { id?: string; status?: string; createdAt?: string };
      }>('/streamer/bot/say', { provider: testMessageProvider, message: msg });

      const usedProvider = typeof res?.provider === 'string' && res.provider.trim() ? res.provider.trim() : testMessageProvider;
      if (res?.outbox && typeof res.outbox === 'object') {
        setLastOutbox({ provider: usedProvider, id: res.outbox.id, status: res.outbox.status, createdAt: res.outbox.createdAt });
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
      if (apiError.response?.status === 404) {
        toast.error(t('admin.botCommandsNotAvailable', { defaultValue: 'This server does not support bot features yet.' }));
        return;
      }
      if (
        apiError.response?.status === 400 &&
        Array.isArray(apiError.response?.data?.enabledProviders) &&
        apiError.response.data.enabledProviders.length > 1
      ) {
        toast.error(
          t('admin.botMultipleProvidersEnabled', {
            defaultValue: 'Включено несколько чат-ботов. Выберите провайдера, куда отправлять сообщение.',
          })
        );
        return;
      }
      if (apiError.response?.status === 400 && testMessageProvider === 'youtube') {
        toast.error(t('admin.youtubeRelinkRequired', { defaultValue: 'Сначала привяжите YouTube заново (нужны новые разрешения).' }));
        return;
      }
      if (apiError.response?.status === 400 && testMessageProvider === 'vkvideo') {
        toast.error(t('admin.vkvideoEnableRequiredToSend', { defaultValue: 'Сначала включите VKVideo-бота для канала.' }));
        return;
      }
      toast.error(
        apiError.response?.data?.error ||
          apiError.response?.data?.message ||
          t('admin.failedToSendBotTestMessage', { defaultValue: 'Failed to send message.' })
      );
    } finally {
      await ensureMinDuration(startedAt, 450);
      setSendingTestMessage(false);
    }
  }, [t, testMessage, testMessageProvider]);

  const isYoutubeRelinkRequiredError = useCallback((error: unknown): boolean => {
    const apiError = error as { response?: { status?: number; data?: any } };
    if (apiError.response?.status !== 412) return false;
    const data = apiError.response?.data || {};
    // Backend may send either code or needsRelink (or both).
    return data?.code === 'YOUTUBE_RELINK_REQUIRED' || data?.needsRelink === true;
  }, []);

  const getCurrentRelativePath = useCallback((): string => {
    // Must be relative (no domain) per backend contract.
    // Preserve current settings tab via querystring (?tab=bot).
    return `${window.location.pathname}${window.location.search}`;
  }, []);

  const startYoutubeRelink = useCallback(() => {
    // Mark intent to retry enabling after OAuth callback returns.
    try {
      window.localStorage.setItem('memalerts:youtubeRelink:retryEnable', String(Date.now()));
      setYoutubeEnableRetryQueued(true);
    } catch {
      // ignore
    }

    setYoutubeRelinkModalOpen(false);
    linkExternalAccount('youtube', getCurrentRelativePath());
  }, [getCurrentRelativePath]);

  const forceResetYoutubeAndRelink = useCallback(async () => {
    const startedAt = Date.now();
    try {
      setYoutubeForceRelinkLoading(true);
      setYoutubeLastRelinkErrorId(null);

      const { api } = await import('@/lib/api');

      // Best-effort: find YouTube external account and unlink it to force a clean OAuth.
      const items = await api.get<unknown>('/auth/accounts', { timeout: 8000 });
      const accounts = Array.isArray(items) ? (items as Array<{ id?: unknown; provider?: unknown }>) : [];
      const ytAcc = accounts.find((a) => String(a?.provider || '').toLowerCase() === 'youtube');

      if (ytAcc?.id && typeof ytAcc.id === 'string') {
        await api.delete(`/auth/accounts/${encodeURIComponent(ytAcc.id)}`);
      }

      // After unlink, start OAuth again.
      startYoutubeRelink();
    } catch (error: unknown) {
      const { getRequestIdFromError } = await import('@/lib/api');
      const rid = getRequestIdFromError(error);
      setYoutubeLastRelinkErrorId(rid);
      toast.error(
        rid
          ? `${t('admin.youtubeRelinkFailed', { defaultValue: 'Не удалось перелинковать YouTube.' })} (${t('common.errorId', { defaultValue: 'Error ID' })}: ${rid})`
          : t('admin.youtubeRelinkFailed', { defaultValue: 'Не удалось перелинковать YouTube.' })
      );
    } finally {
      await ensureMinDuration(startedAt, 450);
      setYoutubeForceRelinkLoading(false);
    }
  }, [startYoutubeRelink, t]);

  const enableYoutubeIntegration = useCallback(async () => {
    const startedAt = Date.now();
    try {
      setBotIntegrationToggleLoading('youtube');
      // optimistic
      setBots((prev) => prev.map((b) => (b.provider === 'youtube' ? { ...b, enabled: true } : b)));
      const { api } = await import('@/lib/api');
      await api.patch('/streamer/bots/youtube', { enabled: true });
      setYoutubeNeedsRelink(false);
      toast.success(t('admin.saved', { defaultValue: 'Saved.' }));
      void loadBotIntegrations();
    } catch (error: unknown) {
      void loadBotIntegrations();
      if (isYoutubeRelinkRequiredError(error)) {
        setYoutubeNeedsRelink(true);
        try {
          const { getRequestIdFromError } = await import('@/lib/api');
          setYoutubeLastRelinkErrorId(getRequestIdFromError(error));
        } catch {
          setYoutubeLastRelinkErrorId(null);
        }
        // Expected precondition — show guided relink UX, not a generic "server error".
        setYoutubeRelinkModalOpen(true);
        return;
      }
      const apiError = error as { response?: { data?: { error?: string } } };
      toast.error(apiError.response?.data?.error || t('admin.failedToSave', { defaultValue: 'Failed to save.' }));
    } finally {
      await ensureMinDuration(startedAt, 450);
      setBotIntegrationToggleLoading(null);
    }
  }, [isYoutubeRelinkRequiredError, loadBotIntegrations, t]);

  const toggleBotIntegration = useCallback(
    async (provider: 'youtube', nextEnabled: boolean) => {
      const startedAt = Date.now();
      try {
        setBotIntegrationToggleLoading(provider);
        if (provider === 'youtube' && !nextEnabled) {
          // Clearing relink UI when user explicitly turns integration off.
          setYoutubeNeedsRelink(false);
          setYoutubeEnableRetryQueued(false);
          setYoutubeLastRelinkErrorId(null);
        }
        // optimistic
        setBots((prev) => prev.map((b) => (b.provider === provider ? { ...b, enabled: nextEnabled } : b)));

        const { api } = await import('@/lib/api');
        await api.patch(`/streamer/bots/${encodeURIComponent(provider)}`, { enabled: nextEnabled });
        toast.success(t('admin.saved', { defaultValue: 'Saved.' }));
        // best-effort refresh (updatedAt may change)
        void loadBotIntegrations();
      } catch (error: unknown) {
        // revert optimistic update by refetching
        void loadBotIntegrations();
        if (provider === 'youtube' && nextEnabled && isYoutubeRelinkRequiredError(error)) {
          setYoutubeNeedsRelink(true);
          setYoutubeEnableRetryQueued(false);
          try {
            const { getRequestIdFromError } = await import('@/lib/api');
            setYoutubeLastRelinkErrorId(getRequestIdFromError(error));
          } catch {
            setYoutubeLastRelinkErrorId(null);
          }
          // Don't treat as "server down" — expected precondition.
          setYoutubeRelinkModalOpen(true);
          return;
        }
        const apiError = error as { response?: { status?: number; data?: { error?: string } } };
        toast.error(apiError.response?.data?.error || t('admin.failedToSave', { defaultValue: 'Failed to save.' }));
      } finally {
        await ensureMinDuration(startedAt, 450);
        setBotIntegrationToggleLoading(null);
      }
    },
    [isYoutubeRelinkRequiredError, loadBotIntegrations, t]
  );

  useEffect(() => {
    // Auto-retry enabling YouTube after successful OAuth re-link.
    // We can't rely on URL params after redirect, so we use a one-time localStorage flag.
    const key = 'memalerts:youtubeRelink:retryEnable';
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) return;
      const ts = Number(raw);
      // Expire after 10 minutes to avoid surprising retries later.
      const isFresh = Number.isFinite(ts) && Date.now() - ts < 10 * 60 * 1000;
      window.localStorage.removeItem(key);
      if (!isFresh) return;

      setBotTab('youtube');
      setYoutubeEnableRetryQueued(false);
      void (async () => {
        // Refresh linked accounts best-effort (backend may rotate tokens/scopes).
        try {
          const { api } = await import('@/lib/api');
          const items = await api.get<unknown>('/auth/accounts', { timeout: 8000 });
          const accounts = Array.isArray(items) ? (items as Array<{ provider?: unknown }>) : [];
          const hasYouTube = accounts.some((a) => String(a?.provider || '').toLowerCase() === 'youtube');
          if (hasYouTube) {
            toast.success(
              t('admin.youtubeRelinked', {
                defaultValue: 'YouTube перелинкован, можно включать бота.',
              })
            );
          }
        } catch {
          // ignore (best-effort)
        }

        void enableYoutubeIntegration();
      })();
    } catch {
      // ignore (private mode, disabled storage, etc.)
    }
  }, [enableYoutubeIntegration]);

  const toggleVkvideoIntegration = useCallback(
    async (nextEnabled: boolean) => {
      const startedAt = Date.now();
      try {
        setBotIntegrationToggleLoading('vkvideo');
        const { api } = await import('@/lib/api');

        if (!nextEnabled) {
          // optimistic
          setBots((prev) => prev.map((b) => (b.provider === 'vkvideo' ? { ...b, enabled: false } : b)));
          await api.patch('/streamer/bots/vkvideo', { enabled: false });
          setVkvideoNotAvailable(false);
          setVkvideoChannels(null);
          setVkvideoSelectedChannel('');
          toast.success(t('admin.saved', { defaultValue: 'Saved.' }));
          void loadBotIntegrations();
          return;
        }

        // enabling
        setVkvideoChannels(null);
        setVkvideoSelectedChannel('');

        // optimistic
        setBots((prev) => prev.map((b) => (b.provider === 'vkvideo' ? { ...b, enabled: true } : b)));

        if (vkvideoEnableMode === 'manual') {
          const channelId = vkvideoChannelId.trim();
          if (!channelId) {
            // revert optimistic update by refetching
            void loadBotIntegrations();
            toast.error(t('admin.vkvideoChannelIdRequired', { defaultValue: 'Enter VKVideo channel id.' }));
            return;
          }
          await api.patch('/streamer/bots/vkvideo', { enabled: true, vkvideoChannelId: channelId });
        } else {
          // auto-detect on backend (requires VKVideo account linking + valid token)
          await api.patch('/streamer/bots/vkvideo', { enabled: true });
        }

        setVkvideoNotAvailable(false);
        toast.success(t('admin.saved', { defaultValue: 'Saved.' }));
        void loadBotIntegrations();
      } catch (error: unknown) {
        void loadBotIntegrations();
        const apiError = error as {
          response?: { status?: number; data?: { error?: string; channels?: string[] } };
        };
        if (apiError.response?.status === 404) {
          // Backend does not support this feature on this instance yet.
          setVkvideoNotAvailable(true);
          toast.error(
            t('admin.featureNotAvailable', { defaultValue: 'Feature not available on this server yet.' })
          );
          return;
        }
        if (apiError.response?.status === 400 && Array.isArray(apiError.response?.data?.channels) && apiError.response?.data?.channels.length > 0) {
          const channels = apiError.response.data.channels.filter((v) => typeof v === 'string' && v.trim()).map((v) => v.trim());
          setVkvideoChannels(channels);
          setVkvideoSelectedChannel(channels[0] || '');
          toast.error(
            t('admin.vkvideoMultipleChannels', {
              defaultValue: 'Найдено несколько VKVideo-каналов. Выберите канал или включите вручную.',
            })
          );
          return;
        }
        toast.error(apiError.response?.data?.error || t('admin.failedToSave', { defaultValue: 'Failed to save.' }));
      } finally {
        await ensureMinDuration(startedAt, 450);
        setBotIntegrationToggleLoading(null);
      }
    },
    [loadBotIntegrations, t, vkvideoChannelId, vkvideoEnableMode]
  );

  const enableVkvideoWithSelectedChannel = useCallback(async () => {
    const channel = vkvideoSelectedChannel.trim();
    if (!channel) return;
    const startedAt = Date.now();
    try {
      setBotIntegrationToggleLoading('vkvideo');
      const { api } = await import('@/lib/api');
      await api.patch('/streamer/bots/vkvideo', { enabled: true, vkvideoChannelId: channel });
      toast.success(t('admin.saved', { defaultValue: 'Saved.' }));
      setVkvideoChannels(null);
      void loadBotIntegrations();
    } catch (error: unknown) {
      const apiError = error as { response?: { data?: { error?: string } } };
      toast.error(apiError.response?.data?.error || t('admin.failedToSave', { defaultValue: 'Failed to save.' }));
    } finally {
      await ensureMinDuration(startedAt, 450);
      setBotIntegrationToggleLoading(null);
    }
  }, [loadBotIntegrations, t, vkvideoSelectedChannel]);

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

  const botsMap = useMemo(() => new Map(bots.map((b) => [b.provider, b])), [bots]);
  const yt = botsMap.get('youtube');
  const ytEnabled = yt?.enabled === true;
  const ytBusy = botIntegrationToggleLoading === 'youtube';
  const vk = botsMap.get('vkvideo');
  const vkEnabled = vk?.enabled === true;
  const vkBusy = botIntegrationToggleLoading === 'vkvideo';

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

      <div className="flex flex-wrap gap-2 mb-4">
        <button
          type="button"
          onClick={() => {
            setBotTab('twitch');
            setTestMessageProvider('twitch');
          }}
          className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
            botTab === 'twitch'
              ? 'bg-primary text-white border-primary'
              : 'bg-transparent text-gray-700 dark:text-gray-200 border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800'
          }`}
        >
          Twitch
        </button>
        <button
          type="button"
          onClick={() => {
            setBotTab('youtube');
            setTestMessageProvider('youtube');
          }}
          className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
            botTab === 'youtube'
              ? 'bg-primary text-white border-primary'
              : 'bg-transparent text-gray-700 dark:text-gray-200 border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800'
          }`}
        >
          YouTube
        </button>
        <button
          type="button"
          onClick={() => {
            setBotTab('vk');
            setTestMessageProvider('vkvideo');
          }}
          className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
            botTab === 'vk'
              ? 'bg-primary text-white border-primary'
              : 'bg-transparent text-gray-700 dark:text-gray-200 border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800'
          }`}
        >
          VK
        </button>
      </div>


      {botTab === 'twitch' ? (
        <>
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
                          defaultValue: 'Stream duration command is not available on this server yet. Please deploy the backend update.',
                        })}
                      </div>
                    )}

                    {!streamDurationNotAvailable && streamDurationEnabled && streamDurationOpen && (
                      <div className="mt-3 space-y-3">
                        <div className="text-xs text-gray-600 dark:text-gray-300">
                          {t('admin.streamDurationLiveOnlyInfo', { defaultValue: 'This command works only while your stream is live.' })}
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
                            {t('admin.streamDurationTemplateVars', { defaultValue: 'Variables: {hours}, {minutes}, {totalMinutes}.' })}
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
                  {/* (existing commands block kept below, unchanged) */}

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
                      'Send a message from the bot into your chat. This helps confirm the bot is connected and visible.',
                  })}
                </div>

                <div className="mt-3 space-y-3">
                  <Textarea
                    rows={2}
                    value={testMessage}
                    onChange={(e) => setTestMessage(e.target.value)}
                    placeholder={t('admin.botDefaultTestMessage', { defaultValue: 'Bot connected ✅' })}
                  />
                  <Button
                    type="button"
                    variant="primary"
                    onClick={() => {
                      setTestMessageProvider('twitch');
                      void sendTestMessage();
                    }}
                    disabled={sendingTestMessage}
                  >
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
        </>
      ) : botTab === 'youtube' ? (
        <>
          <ConfirmDialog
            isOpen={youtubeRelinkModalOpen}
            onClose={() => setYoutubeRelinkModalOpen(false)}
            onConfirm={startYoutubeRelink}
            title={t('admin.youtubeRelinkTitle', { defaultValue: 'Перелинковать YouTube' })}
            message={t('admin.youtubeRelinkBody', {
              defaultValue:
                'Нужно перелинковать YouTube (истёк токен или не хватает прав). Если после перелинковки ошибка повторяется — нажмите “Сбросить привязку и перелинковать”.',
            })}
            confirmText={t('admin.youtubeRelinkConfirm', { defaultValue: 'Перелинковать' })}
            cancelText={t('common.close', { defaultValue: 'Закрыть' })}
            confirmButtonClass="bg-primary hover:bg-primary/90"
          />
          {/* YouTube integration */}
          <div className="glass p-4 mb-4 relative">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="font-semibold text-gray-900 dark:text-white">YouTube</div>
                <div className="text-sm text-gray-600 dark:text-gray-300 mt-1">
                  {t('admin.youtubeBotIntegrationHint', {
                    defaultValue: 'Requires YouTube re-link after scope update (YouTube Data API).',
                  })}
                  {yt?.updatedAt ? (
                    <span className="ml-2 opacity-80">
                      {t('admin.updatedAt', { defaultValue: 'Updated' })}: {new Date(yt.updatedAt).toLocaleString()}
                    </span>
                  ) : null}
                </div>
              </div>
              {botsLoading ? <Spinner className="h-5 w-5" /> : null}
              <ToggleSwitch
                checked={ytEnabled}
                disabled={!botsLoaded || botsLoading || ytBusy}
                busy={ytBusy}
                onChange={(next) => void toggleBotIntegration('youtube', next)}
                ariaLabel={t('admin.youtubeBotIntegrationLabel', { defaultValue: 'YouTube bot enabled' })}
              />
            </div>

            {youtubeNeedsRelink && !ytEnabled && (
              <div className="mt-3 rounded-lg bg-amber-50/70 dark:bg-amber-900/20 ring-1 ring-amber-200/60 dark:ring-amber-700/40 px-3 py-2">
                <div className="text-sm text-amber-950 dark:text-amber-100 font-medium">
                  {t('admin.youtubeRelinkRequiredNotice', {
                    defaultValue:
                      "Нужно перелинковать YouTube (не хватает прав или токен устарел). Нажмите ‘Перелинковать’.",
                  })}
                </div>
                {youtubeLastRelinkErrorId ? (
                  <div className="mt-1 text-xs text-amber-900/80 dark:text-amber-100/80">
                    {t('common.errorId', { defaultValue: 'Error ID' })}: {youtubeLastRelinkErrorId}
                  </div>
                ) : null}
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="primary"
                    onClick={() => {
                      startYoutubeRelink();
                    }}
                  >
                    {t('admin.youtubeRelinkConfirm', { defaultValue: 'Перелинковать' })}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => void forceResetYoutubeAndRelink()}
                    disabled={ytBusy || youtubeForceRelinkLoading}
                  >
                    {youtubeForceRelinkLoading
                      ? t('common.loading', { defaultValue: 'Loading…' })
                      : t('admin.youtubeForceRelink', { defaultValue: 'Сбросить привязку и перелинковать' })}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => void enableYoutubeIntegration()}
                    disabled={ytBusy}
                  >
                    {t('admin.youtubeRetryEnableAction', { defaultValue: 'Повторить включение' })}
                  </Button>
                </div>
                {youtubeEnableRetryQueued ? (
                  <div className="mt-2 text-xs text-amber-900/80 dark:text-amber-100/80">
                    {t('admin.youtubeRelinkWillRetry', { defaultValue: 'После привязки попробуем включить автоматически.' })}
                  </div>
                ) : null}
              </div>
            )}
          </div>

          {/* YouTube test message */}
          <div className="glass p-4">
            <div className="font-semibold text-gray-900 dark:text-white">
              {t('admin.botTestMessageTitle', { defaultValue: 'Test message' })}
            </div>
            <div className="text-sm text-gray-600 dark:text-gray-300 mt-1">
              {t('admin.botTestMessageHintYoutube', {
                defaultValue: 'Send a message from the bot into your YouTube live chat. This helps confirm the bot is connected.',
              })}
            </div>

            <div className="mt-3 space-y-3">
              <Textarea
                rows={2}
                value={testMessage}
                onChange={(e) => setTestMessage(e.target.value)}
                placeholder={t('admin.botDefaultTestMessage', { defaultValue: 'Bot connected ✅' })}
              />
              <Button
                type="button"
                variant="primary"
                onClick={() => {
                  setTestMessageProvider('youtube');
                  void sendTestMessage();
                }}
                disabled={sendingTestMessage}
              >
                {t('admin.sendTestMessage', { defaultValue: 'Send test message' })}
              </Button>
              {!ytEnabled && (
                <div className="text-xs text-amber-800 dark:text-amber-200">
                  {t('admin.youtubeEnableRequiredToSend', { defaultValue: 'Сначала включите YouTube-бота для канала.' })}
                </div>
              )}
            </div>
          </div>
        </>
      ) : (
        <>
          {/* VKVideo integration */}
          <div className="glass p-4 mb-4 relative">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="font-semibold text-gray-900 dark:text-white">VK Video Live</div>
                <div className="text-sm text-gray-600 dark:text-gray-300 mt-1">
                  {vkvideoNotAvailable
                    ? t('admin.featureNotAvailableShort', { defaultValue: 'Not available on this server.' })
                    : t('admin.vkvideoBotIntegrationHintV2', {
                        defaultValue:
                          "Сначала привяжите VKVideo в 'Accounts'. Включение может сработать автоматически; если каналов несколько — выберите один или укажите вручную.",
                      })}
                  <span className="ml-2">
                    <a
                      href="https://dev.live.vkvideo.ru/docs/main/authorization"
                      target="_blank"
                      rel="noreferrer"
                      className="underline hover:no-underline"
                    >
                      {t('admin.vkvideoDocs', { defaultValue: 'Docs' })}
                    </a>
                  </span>
                  {vk?.updatedAt ? (
                    <span className="ml-2 opacity-80">
                      {t('admin.updatedAt', { defaultValue: 'Updated' })}: {new Date(vk.updatedAt).toLocaleString()}
                    </span>
                  ) : null}
                </div>
              </div>
              {botsLoading ? <Spinner className="h-5 w-5" /> : null}
              <ToggleSwitch
                checked={vkEnabled}
                disabled={!botsLoaded || botsLoading || vkBusy || vkvideoNotAvailable}
                busy={vkBusy}
                onChange={(next) => void toggleVkvideoIntegration(next)}
                ariaLabel={t('admin.vkvideoBotIntegrationLabel', { defaultValue: 'VKVideo bot enabled' })}
              />
            </div>

            <div className="mt-3 rounded-lg bg-white/40 dark:bg-white/5 ring-1 ring-black/5 dark:ring-white/10 px-3 py-2">
              <div className="text-xs font-semibold text-gray-700 dark:text-gray-200">
                {t('admin.vkvideoEnableModeTitle', { defaultValue: 'Enable mode' })}
              </div>
              <div className="mt-2 flex flex-wrap gap-4 text-xs text-gray-700 dark:text-gray-200">
                <label className="inline-flex items-center gap-2">
                  <input
                    type="radio"
                    name="vkvideoEnableMode"
                    checked={vkvideoEnableMode === 'auto'}
                    onChange={() => setVkvideoEnableMode('auto')}
                    disabled={vkBusy || vkEnabled}
                  />
                  {t('admin.vkvideoEnableModeAuto', { defaultValue: 'Auto (no id)' })}
                </label>
                <label className="inline-flex items-center gap-2">
                  <input
                    type="radio"
                    name="vkvideoEnableMode"
                    checked={vkvideoEnableMode === 'manual'}
                    onChange={() => setVkvideoEnableMode('manual')}
                    disabled={vkBusy || vkEnabled}
                  />
                  {t('admin.vkvideoEnableModeManual', { defaultValue: 'Manual (vkvideoChannelId)' })}
                </label>
              </div>
              <div className="mt-1 text-[11px] text-gray-600 dark:text-gray-300">
                {t('admin.vkvideoEnableModeHint', {
                  defaultValue:
                    'Auto requires a linked VKVideo account and that VKVideo API returns exactly one channel. Manual lets you specify the channel id/slug used in chat WS URL template.',
                })}
              </div>
            </div>

            {vkvideoChannels && vkvideoChannels.length > 0 && (
              <div className="mt-3 rounded-lg bg-amber-50/70 dark:bg-amber-900/20 ring-1 ring-amber-200/60 dark:ring-amber-700/40 px-3 py-2">
                <div className="text-xs font-semibold text-amber-900 dark:text-amber-100">
                  {t('admin.vkvideoMultipleChannelsTitle', { defaultValue: 'Multiple channels detected' })}
                </div>
                <div className="mt-1 text-xs text-amber-900/90 dark:text-amber-100/90">
                  {t('admin.vkvideoMultipleChannelsHint', {
                    defaultValue: 'Select one channel and enable it (manual enable will be used under the hood).',
                  })}
                </div>
                <div className="mt-2 flex flex-col sm:flex-row gap-2 sm:items-center">
                  <select
                    className="flex-1 rounded-lg bg-white/80 dark:bg-white/5 ring-1 ring-black/10 dark:ring-white/10 px-3 py-2 text-sm text-gray-900 dark:text-white"
                    value={vkvideoSelectedChannel}
                    onChange={(e) => setVkvideoSelectedChannel(e.target.value)}
                    disabled={vkBusy}
                  >
                    {vkvideoChannels.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                  <Button
                    type="button"
                    variant="primary"
                    onClick={() => void enableVkvideoWithSelectedChannel()}
                    disabled={vkBusy || !vkvideoSelectedChannel.trim()}
                  >
                    {t('admin.enable', { defaultValue: 'Enable' })}
                  </Button>
                </div>
              </div>
            )}

            <div className="mt-3">
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-200 mb-1">
                {t('admin.vkvideoChannelIdLabel', { defaultValue: 'VKVideo channel id' })}
              </label>
              <Input
                value={vkvideoChannelId}
                onChange={(e) => setVkvideoChannelId(e.target.value)}
                placeholder={t('admin.vkvideoChannelIdPlaceholder', { defaultValue: 'e.g. 1234567890' })}
                disabled={!botsLoaded || botsLoading || vkvideoNotAvailable || vkBusy || vkEnabled}
              />
              <div className="mt-1 text-[11px] text-gray-600 dark:text-gray-300">
                {t('admin.vkvideoChannelIdHelpV2', {
                  defaultValue:
                    'Used when enabling in manual mode or when multiple channels were detected (we pass this value to backend as vkvideoChannelId).',
                })}
              </div>
            </div>
          </div>

          {/* VK test message */}
          <div className="glass p-4">
            <div className="font-semibold text-gray-900 dark:text-white">
              {t('admin.botTestMessageTitle', { defaultValue: 'Test message' })}
            </div>
            <div className="text-sm text-gray-600 dark:text-gray-300 mt-1">
              {t('admin.botTestMessageHintVk', {
                defaultValue: 'Send a message from the bot into your VKVideo chat. This helps confirm the bot is connected.',
              })}
            </div>

            <div className="mt-3 space-y-3">
              <Textarea
                rows={2}
                value={testMessage}
                onChange={(e) => setTestMessage(e.target.value)}
                placeholder={t('admin.botDefaultTestMessage', { defaultValue: 'Bot connected ✅' })}
              />
              <Button
                type="button"
                variant="primary"
                onClick={() => {
                  setTestMessageProvider('vkvideo');
                  void sendTestMessage();
                }}
                disabled={sendingTestMessage}
              >
                {t('admin.sendTestMessage', { defaultValue: 'Send test message' })}
              </Button>

              {lastOutbox && lastOutbox.provider === 'vkvideo' && (
                <div className="text-xs text-gray-600 dark:text-gray-300">
                  {t('admin.vkvideoOutboxStatus', {
                    defaultValue: 'Outbox status: {{status}}',
                    status: lastOutbox.status || 'unknown',
                  })}
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
                  {(lastOutbox.status || '').toLowerCase() === 'pending' ? (
                    <div className="mt-1">
                      {t('admin.vkvideoOutboxPendingHint', {
                        defaultValue:
                          'pending = сообщение в очереди. Если раннер/консьюмер на сервере не запущен или не подключён к чату — сообщение не появится.',
                      })}
                    </div>
                  ) : null}
                  {(() => {
                    if (!lastOutbox.createdAt) return null;
                    const createdAtMs = Date.parse(lastOutbox.createdAt);
                    if (!Number.isFinite(createdAtMs)) return null;
                    const ageSec = Math.max(0, Math.floor((Date.now() - createdAtMs) / 1000));
                    if ((lastOutbox.status || '').toLowerCase() === 'pending' && ageSec >= 60) {
                      return (
                        <div className="mt-1 text-amber-800 dark:text-amber-200">
                          {t('admin.vkvideoRunnerCheckHint', {
                            defaultValue: 'Если статус долго не меняется — проверьте, запущен ли VKVideo bot runner на сервере.',
                          })}
                        </div>
                      );
                    }
                    return null;
                  })()}
                </div>
              )}
              {!vkEnabled && (
                <div className="text-xs text-amber-800 dark:text-amber-200">
                  {t('admin.vkvideoEnableRequiredToSend', { defaultValue: 'Сначала включите VKVideo-бота для канала.' })}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}


