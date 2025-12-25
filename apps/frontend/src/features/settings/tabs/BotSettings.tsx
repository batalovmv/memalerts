import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

import ConfirmDialog from '@/components/ConfirmDialog';
import { getApiOriginForRedirect } from '@/shared/auth/login';
import { getRuntimeConfig } from '@/shared/config/runtimeConfig';
import { ensureMinDuration } from '@/shared/lib/ensureMinDuration';
import { Button, Input, Spinner, Textarea } from '@/shared/ui';
import { SavingOverlay } from '@/shared/ui/StatusOverlays';
import { useAppSelector } from '@/store/hooks';

type ApiErrorData = {
  code?: unknown;
  error?: unknown;
  message?: unknown;
  needsRelink?: unknown;
  reason?: unknown;
  requiredScopesMissing?: unknown;
};

type ApiErrorShape = {
  response?: {
    status?: number;
    data?: ApiErrorData;
  };
};

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
  vkvideoChannelUrl?: string | null;
};

type ToggleSwitchProps = {
  checked: boolean;
  disabled?: boolean;
  busy?: boolean;
  onChange: (next: boolean) => void;
  ariaLabel?: string;
};

type OverrideStatus = {
  enabled: boolean;
  updatedAt?: string | null;
  externalAccountId?: string | null;
  lockedBySubscription?: boolean | null;
};

type CustomBotEntitlementStatus = 'unknown' | 'entitled' | 'not_entitled';

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
  const [youtubeLastRelinkErrorId, setYoutubeLastRelinkErrorId] = useState<string | null>(null);
  const [youtubeOverrideStatus, setYoutubeOverrideStatus] = useState<OverrideStatus | null>(null);
  const [youtubeOverrideLoading, setYoutubeOverrideLoading] = useState(false);
  const [youtubeOverrideBusy, setYoutubeOverrideBusy] = useState(false);
  const [twitchOverrideStatus, setTwitchOverrideStatus] = useState<OverrideStatus | null>(null);
  const [twitchOverrideLoading, setTwitchOverrideLoading] = useState(false);
  const [twitchOverrideBusy, setTwitchOverrideBusy] = useState(false);
  const [vkvideoOverrideStatus, setVkvideoOverrideStatus] = useState<OverrideStatus | null>(null);
  const [vkvideoOverrideLoading, setVkvideoOverrideLoading] = useState(false);
  const [vkvideoOverrideBusy, setVkvideoOverrideBusy] = useState(false);

  const [customBotEntitlement, setCustomBotEntitlement] = useState<CustomBotEntitlementStatus>('unknown');
  const [subscriptionRequiredModalOpen, setSubscriptionRequiredModalOpen] = useState(false);
  const [subscriptionRequiredModalProvider, setSubscriptionRequiredModalProvider] = useState<'twitch' | 'youtube' | 'vkvideo' | null>(null);
  const [oauthSubscriptionRequiredBanner, setOauthSubscriptionRequiredBanner] = useState<{ provider: 'twitch' | 'youtube' | 'vkvideo' } | null>(
    null
  );
  const [twitchBotNotConfiguredHint, setTwitchBotNotConfiguredHint] = useState(false);
  const [vkvideoNotAvailable, setVkvideoNotAvailable] = useState(false);
  const [vkvideoChannelId, setVkvideoChannelId] = useState('');
  const [vkvideoChannelUrl, setVkvideoChannelUrl] = useState('');
  const [vkvideoEnableMode, setVkvideoEnableMode] = useState<'auto' | 'manual'>('auto');
  const [vkvideoChannels, setVkvideoChannels] = useState<string[] | null>(null);
  const [vkvideoSelectedChannel, setVkvideoSelectedChannel] = useState<string>('');
  const [vkvideoUrlModalOpen, setVkvideoUrlModalOpen] = useState(false);
  const [vkvideoUrlModalBusy, setVkvideoUrlModalBusy] = useState(false);
  const [vkvideoUrlModalRequestId, setVkvideoUrlModalRequestId] = useState<string | null>(null);
  type VkvideoCandidate = { url: string; vkvideoChannelId?: string | null };
  const [vkvideoCandidatesLoading, setVkvideoCandidatesLoading] = useState(false);
  const [vkvideoCandidatesNotLinked, setVkvideoCandidatesNotLinked] = useState(false);
  const [vkvideoCandidates, setVkvideoCandidates] = useState<VkvideoCandidate[] | null>(null);
  const [vkvideoSelectedCandidateUrl, setVkvideoSelectedCandidateUrl] = useState<string>('');

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
  const [lastOutboxRequest, setLastOutboxRequest] = useState<null | { provider: 'twitch' | 'youtube' | 'vkvideo'; message: string }>(
    null
  );

  const outboxPollTimerRef = useRef<number | null>(null);
  const outboxPollStartedAtRef = useRef<number>(0);
  const outboxPollInFlightRef = useRef(false);
  const outboxPollKeyRef = useRef<string>('');

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
      if (vk && typeof vk.vkvideoChannelUrl === 'string' && vk.vkvideoChannelUrl.trim()) {
        setVkvideoChannelUrl(vk.vkvideoChannelUrl.trim());
      }

      setBotsLoaded(true);
    } catch (error: unknown) {
      // Keep quiet on load; the rest of the page works without it.
      setBotsLoaded(false);
    } finally {
      setBotsLoading(false);
    }
  }, []);

  const loadVkvideoCandidates = useCallback(async () => {
    try {
      setVkvideoCandidatesLoading(true);
      setVkvideoCandidatesNotLinked(false);
      const { api } = await import('@/lib/api');
      const res = await api.get<{ items?: Array<{ url?: unknown; vkvideoChannelId?: unknown }> }>('/streamer/bots/vkvideo/candidates', {
        timeout: 8000,
      });
      const items = Array.isArray(res?.items) ? res.items : [];
      const normalized: VkvideoCandidate[] = items
        .map((it) => ({
          url: typeof it?.url === 'string' ? it.url.trim() : '',
          vkvideoChannelId: typeof it?.vkvideoChannelId === 'string' ? it.vkvideoChannelId : null,
        }))
        .filter((it) => !!it.url);
      setVkvideoCandidates(normalized);
      if (normalized.length > 0) {
        setVkvideoSelectedCandidateUrl((prev) => prev || normalized[0]!.url);
      }
    } catch (error: unknown) {
      const apiError = error as ApiErrorShape;
      if (apiError.response?.status === 400 && String(apiError.response?.data?.code || '') === 'VKVIDEO_NOT_LINKED') {
        setVkvideoCandidatesNotLinked(true);
        setVkvideoCandidates([]);
        return;
      }
      // Best-effort: do not block if endpoint isn't available yet.
      if (apiError.response?.status === 404) return;
    } finally {
      setVkvideoCandidatesLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSubscription();
    void loadBotIntegrations();
    void loadFollowGreetings();
  }, [loadBotIntegrations, loadFollowGreetings, loadSubscription]);

  useEffect(() => {
    if (botTab !== 'vk') return;
    if (vkvideoCandidates !== null) return;
    void loadVkvideoCandidates();
  }, [botTab, loadVkvideoCandidates, vkvideoCandidates]);

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
          usedProvider === 'twitch' || usedProvider === 'youtube' || usedProvider === 'vkvideo' ? usedProvider : provider;

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
              ? `${t('admin.botCommandsNotAvailable', { defaultValue: 'This server does not support bot features yet.' })} (${t('common.errorId', { defaultValue: 'Error ID' })}: ${rid})`
              : t('admin.botCommandsNotAvailable', { defaultValue: 'This server does not support bot features yet.' })
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
      const msg = (testMessage || t('admin.botDefaultTestMessage', { defaultValue: 'Bot connected ✅' })).trim();
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
    // UX: stop after ~30s to avoid infinite polling; user can still use Outbox ID for support.
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
      const res = await api.get<OutboxStatusResponse>(`/streamer/bot/outbox/${encodeURIComponent(provider)}/${encodeURIComponent(id)}`, {
        timeout: 8000,
      });

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

      // Mild backoff: faster while pending, slower while processing.
      const nextDelay = nextStatus === 'processing' ? 2000 : 1200;
      scheduleNext(nextDelay);
    } catch {
      // If poll fails transiently, retry with backoff.
      scheduleNext(2500);
    } finally {
      outboxPollInFlightRef.current = false;
    }
  }, [lastOutbox, stopOutboxPolling]);

  useEffect(() => {
    // Start polling when we have an outbox id and status is not final.
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

  const isVkvideoChannelUrlRequiredError = useCallback(async (error: unknown): Promise<{ requestId: string | null } | null> => {
    const apiError = error as ApiErrorShape;
    if (apiError.response?.status !== 400) return null;
    const data = apiError.response?.data || {};
    const msg = String(data?.error || data?.message || '');
    if (!msg.toLowerCase().includes('vkvideochannelurl')) return null;
    const { getRequestIdFromError } = await import('@/lib/api');
    return { requestId: getRequestIdFromError(error) };
  }, []);

  const isYoutubeRelinkRequiredError = useCallback((error: unknown): boolean => {
    const apiError = error as ApiErrorShape;
    if (apiError.response?.status !== 412) return false;
    const data = apiError.response?.data || {};
    // Backend may send either code or needsRelink (or both).
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

      // 412 is handled by relink CTA in UI (special UX)
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
        // Unknown 412 precondition — still show a helpful message.
        const serverMessage = typeof data?.error === 'string' ? data.error : null;
        return {
          message:
            serverMessage ||
            t('admin.youtubeEnablePreconditionFailed', { defaultValue: 'Не удалось включить YouTube-бота (предусловие не выполнено).' }),
          requestId,
        };
      }

      return null;
    },
    [t]
  );

  const getCurrentRelativePath = useCallback((): string => {
    // Must be relative (no domain) per backend contract.
    // Preserve current settings tab via querystring (?tab=bot).
    return `${window.location.pathname}${window.location.search}`;
  }, []);

  const billingUrl = useMemo(() => {
    const v = getRuntimeConfig()?.billingUrl;
    return typeof v === 'string' && v.trim() ? v.trim() : null;
  }, []);

  const showSubscriptionRequiredModal = useCallback((provider: 'twitch' | 'youtube' | 'vkvideo') => {
    setSubscriptionRequiredModalProvider(provider);
    setSubscriptionRequiredModalOpen(true);
  }, []);

  const loadCustomBotEntitlement = useCallback(async () => {
    // Recommended UX: dedicated entitlement endpoint (may not exist yet).
    // Missing endpoint => unknown (do not block; we'll still handle 403 on link start).
    try {
      const { api } = await import('@/lib/api');
      const res = await api.get<unknown>('/streamer/entitlements/custom-bot', { timeout: 8000 });
      const entitledRaw = (res as { entitled?: unknown } | null)?.entitled;
      if (typeof entitledRaw === 'boolean') {
        setCustomBotEntitlement(entitledRaw ? 'entitled' : 'not_entitled');
      } else {
        setCustomBotEntitlement('unknown');
      }
    } catch (e: unknown) {
      const err = e as { response?: { status?: number } };
      if (err?.response?.status === 404) {
        setCustomBotEntitlement('unknown');
        return;
      }
      setCustomBotEntitlement('unknown');
    }
  }, []);

  useEffect(() => {
    void loadCustomBotEntitlement();
  }, [loadCustomBotEntitlement]);

  useEffect(() => {
    // OAuth callback error handling:
    // error=auth_failed&reason=subscription_required&provider=twitch|youtube|vkvideo
    try {
      const url = new URL(window.location.href);
      const reason = url.searchParams.get('reason');
      const provider = (url.searchParams.get('provider') || '').toLowerCase();
      const isProvider = provider === 'twitch' || provider === 'youtube' || provider === 'vkvideo';
      if (reason === 'subscription_required' && isProvider) {
        setOauthSubscriptionRequiredBanner({ provider: provider as 'twitch' | 'youtube' | 'vkvideo' });
        url.searchParams.delete('error');
        url.searchParams.delete('reason');
        url.searchParams.delete('provider');
        window.history.replaceState({}, '', url.toString());
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    // Deep link support: /settings/bot/youtube (or /settings/bot/vk)
    const sub = window.location.pathname.replace(/^\/settings\/?/, '');
    const parts = sub.split('/').filter(Boolean);
    if (parts[0] !== 'bot') return;
    const provider = (parts[1] || '').toLowerCase();
    if (provider === 'youtube') setBotTab('youtube');
    else if (provider === 'vk') setBotTab('vk');
    else if (provider === 'twitch') setBotTab('twitch');
  }, []);

  const startStreamerYoutubeAccountRelink = useCallback(() => {
    const apiOrigin = getApiOriginForRedirect();
    const url = new URL(`${apiOrigin}/auth/youtube/link`);
    // UX path (must be in backend allowlist): return to YouTube bot section.
    url.searchParams.set('redirect_to', '/settings/bot/youtube');
    url.searchParams.set('origin', window.location.origin);
    window.location.href = url.toString();
  }, [getCurrentRelativePath]);

  const loadYoutubeOverride = useCallback(async () => {
    try {
      setYoutubeOverrideLoading(true);
      const { api } = await import('@/lib/api');
      const res = await api.get<unknown>('/streamer/bots/youtube/bot', { timeout: 8000 });
      const enabled = Boolean((res as { enabled?: unknown } | null)?.enabled);
      const updatedAtRaw = (res as { updatedAt?: unknown } | null)?.updatedAt;
      const updatedAt = typeof updatedAtRaw === 'string' ? updatedAtRaw : null;
      const externalAccountIdRaw = (res as { externalAccountId?: unknown } | null)?.externalAccountId;
      const externalAccountId = typeof externalAccountIdRaw === 'string' ? externalAccountIdRaw : null;
      const lockedRaw = (res as { lockedBySubscription?: unknown } | null)?.lockedBySubscription;
      const lockedBySubscription = typeof lockedRaw === 'boolean' ? lockedRaw : null;
      setYoutubeOverrideStatus({ enabled, updatedAt, externalAccountId, lockedBySubscription });
    } catch {
      setYoutubeOverrideStatus(null);
    } finally {
      setYoutubeOverrideLoading(false);
    }
  }, []);

  useEffect(() => {
    if (botTab !== 'youtube') return;
    void loadYoutubeOverride();
  }, [botTab, loadYoutubeOverride]);

  const loadTwitchOverride = useCallback(async () => {
    try {
      setTwitchOverrideLoading(true);
      const { api } = await import('@/lib/api');
      const res = await api.get<unknown>('/streamer/bots/twitch/bot', { timeout: 8000 });
      const enabled = Boolean((res as { enabled?: unknown } | null)?.enabled);
      const updatedAtRaw = (res as { updatedAt?: unknown } | null)?.updatedAt;
      const updatedAt = typeof updatedAtRaw === 'string' ? updatedAtRaw : null;
      const externalAccountIdRaw = (res as { externalAccountId?: unknown } | null)?.externalAccountId;
      const externalAccountId = typeof externalAccountIdRaw === 'string' ? externalAccountIdRaw : null;
      const lockedRaw = (res as { lockedBySubscription?: unknown } | null)?.lockedBySubscription;
      const lockedBySubscription = typeof lockedRaw === 'boolean' ? lockedRaw : null;
      setTwitchOverrideStatus({ enabled, updatedAt, externalAccountId, lockedBySubscription });
    } catch {
      setTwitchOverrideStatus(null);
    } finally {
      setTwitchOverrideLoading(false);
    }
  }, []);

  useEffect(() => {
    if (botTab !== 'twitch') return;
    void loadTwitchOverride();
  }, [botTab, loadTwitchOverride]);

  const loadVkvideoOverride = useCallback(async () => {
    try {
      setVkvideoOverrideLoading(true);
      const { api } = await import('@/lib/api');
      const res = await api.get<unknown>('/streamer/bots/vkvideo/bot', { timeout: 8000 });
      const enabled = Boolean((res as { enabled?: unknown } | null)?.enabled);
      const updatedAtRaw = (res as { updatedAt?: unknown } | null)?.updatedAt;
      const updatedAt = typeof updatedAtRaw === 'string' ? updatedAtRaw : null;
      const externalAccountIdRaw = (res as { externalAccountId?: unknown } | null)?.externalAccountId;
      const externalAccountId = typeof externalAccountIdRaw === 'string' ? externalAccountIdRaw : null;
      const lockedRaw = (res as { lockedBySubscription?: unknown } | null)?.lockedBySubscription;
      const lockedBySubscription = typeof lockedRaw === 'boolean' ? lockedRaw : null;
      setVkvideoOverrideStatus({ enabled, updatedAt, externalAccountId, lockedBySubscription });
    } catch {
      setVkvideoOverrideStatus(null);
    } finally {
      setVkvideoOverrideLoading(false);
    }
  }, []);

  useEffect(() => {
    if (botTab !== 'vk') return;
    void loadVkvideoOverride();
  }, [botTab, loadVkvideoOverride]);

  const preflightAndRedirectToOverrideLink = useCallback(
    async (provider: 'twitch' | 'youtube' | 'vkvideo') => {
      if (customBotEntitlement === 'not_entitled') {
        showSubscriptionRequiredModal(provider);
        return;
      }

      const apiOrigin = getApiOriginForRedirect();
      const redirectTo =
        provider === 'youtube' ? '/settings/bot/youtube' : provider === 'twitch' ? '/settings/bot/twitch' : '/settings/bot/vk';
      const url = new URL(`${apiOrigin}/streamer/bots/${provider}/bot/link`);
      url.searchParams.set('redirect_to', redirectTo);
      url.searchParams.set('origin', window.location.origin);

      try {
        const res = await fetch(url.toString(), {
          method: 'GET',
          credentials: 'include',
          redirect: 'manual',
          headers: { Accept: 'application/json' },
        });

        if (res.status === 403) {
          let code: string | null = null;
          try {
            const json = (await res.json()) as { code?: unknown };
            code = typeof json?.code === 'string' ? json.code : null;
          } catch {
            // ignore
          }
          if (code === 'SUBSCRIPTION_REQUIRED') {
            showSubscriptionRequiredModal(provider);
            return;
          }
        }

        window.location.href = url.toString();
      } catch {
        window.location.href = url.toString();
      }
    },
    [customBotEntitlement, showSubscriptionRequiredModal]
  );

  const isCustomBotConnectLocked = customBotEntitlement === 'not_entitled';
  const isOverrideConnectedButLocked = useCallback((s: OverrideStatus | null): boolean => {
    return Boolean(s?.enabled && s?.externalAccountId && s?.lockedBySubscription);
  }, []);

  const disconnectYoutubeOverride = useCallback(async () => {
    if (youtubeOverrideBusy) return;
    const confirmed = window.confirm(
      t('admin.youtubeOverrideDisconnectConfirm', { defaultValue: 'Отключить вашего YouTube-бота (override)?' })
    );
    if (!confirmed) return;

    const startedAt = Date.now();
    try {
      setYoutubeOverrideBusy(true);
      const { api } = await import('@/lib/api');
      await api.delete('/streamer/bots/youtube/bot');
      toast.success(t('admin.saved', { defaultValue: 'Saved.' }));
      await loadYoutubeOverride();
    } catch (e) {
      const apiError = e as { response?: { data?: { error?: string; message?: string } } };
      const msg =
        apiError.response?.data?.error ||
        apiError.response?.data?.message ||
        t('admin.failedToSave', { defaultValue: 'Failed to save.' });
      toast.error(msg);
    } finally {
      await ensureMinDuration(startedAt, 350);
      setYoutubeOverrideBusy(false);
    }
  }, [loadYoutubeOverride, t, youtubeOverrideBusy]);

  const disconnectTwitchOverride = useCallback(async () => {
    if (twitchOverrideBusy) return;
    const confirmed = window.confirm(t('admin.twitchOverrideDisconnectConfirm', { defaultValue: 'Отключить вашего Twitch-бота (override)?' }));
    if (!confirmed) return;

    const startedAt = Date.now();
    try {
      setTwitchOverrideBusy(true);
      const { api } = await import('@/lib/api');
      await api.delete('/streamer/bots/twitch/bot');
      toast.success(t('admin.saved', { defaultValue: 'Saved.' }));
      await loadTwitchOverride();
    } catch (e) {
      const apiError = e as { response?: { data?: { error?: string; message?: string } } };
      const msg =
        apiError.response?.data?.error ||
        apiError.response?.data?.message ||
        t('admin.failedToSave', { defaultValue: 'Failed to save.' });
      toast.error(msg);
    } finally {
      await ensureMinDuration(startedAt, 350);
      setTwitchOverrideBusy(false);
    }
  }, [loadTwitchOverride, t, twitchOverrideBusy]);

  const disconnectVkvideoOverride = useCallback(async () => {
    if (vkvideoOverrideBusy) return;
    const confirmed = window.confirm(
      t('admin.vkvideoOverrideDisconnectConfirm', { defaultValue: 'Отключить вашего VKVideo-бота (override)?' })
    );
    if (!confirmed) return;

    const startedAt = Date.now();
    try {
      setVkvideoOverrideBusy(true);
      const { api } = await import('@/lib/api');
      await api.delete('/streamer/bots/vkvideo/bot');
      toast.success(t('admin.saved', { defaultValue: 'Saved.' }));
      await loadVkvideoOverride();
    } catch (e) {
      const apiError = e as { response?: { data?: { error?: string; message?: string } } };
      const msg =
        apiError.response?.data?.error ||
        apiError.response?.data?.message ||
        t('admin.failedToSave', { defaultValue: 'Failed to save.' });
      toast.error(msg);
    } finally {
      await ensureMinDuration(startedAt, 350);
      setVkvideoOverrideBusy(false);
    }
  }, [loadVkvideoOverride, t, vkvideoOverrideBusy]);

  const toggleBotIntegration = useCallback(
    async (provider: 'youtube', nextEnabled: boolean) => {
      const startedAt = Date.now();
      try {
        setBotIntegrationToggleLoading(provider);
        if (provider === 'youtube' && !nextEnabled) {
          // Clearing relink UI when user explicitly turns integration off.
          setYoutubeNeedsRelink(false);
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
          try {
            const { getRequestIdFromError } = await import('@/lib/api');
            setYoutubeLastRelinkErrorId(getRequestIdFromError(error));
          } catch {
            setYoutubeLastRelinkErrorId(null);
          }
          // Don't treat as "server down" — expected precondition. Show relink CTA in-place.
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

        // enabling (recommended flow via candidates)
        // Ensure candidates are loaded (best-effort).
        if (vkvideoCandidates === null && !vkvideoCandidatesLoading) {
          await loadVkvideoCandidates();
        }

        if (vkvideoCandidatesNotLinked) {
          void loadBotIntegrations();
          toast.error(t('admin.vkvideoNotLinked', { defaultValue: "Сначала привяжите VKVideo в 'Accounts'." }));
          return;
        }

        const candidates = Array.isArray(vkvideoCandidates) ? vkvideoCandidates : [];
        if (candidates.length === 1) {
          // optimistic
          setBots((prev) => prev.map((b) => (b.provider === 'vkvideo' ? { ...b, enabled: true } : b)));
          await api.patch('/streamer/bots/vkvideo', { enabled: true, vkvideoChannelUrl: candidates[0]!.url });
        } else if (candidates.length > 1) {
          // Let user pick a URL in UI, then click Enable.
          setVkvideoSelectedCandidateUrl((prev) => prev || candidates[0]!.url);
          toast.error(
            t('admin.vkvideoMultipleCandidates', {
              defaultValue: 'Найдено несколько VKVideo-каналов. Выберите канал и нажмите “Включить”.',
            })
          );
          return;
        } else {
          // No candidates => require manual URL input.
          const url = vkvideoChannelUrl.trim();
          if (!url) {
            setVkvideoUrlModalRequestId(null);
            setVkvideoUrlModalOpen(true);
            return;
          }
          // optimistic
          setBots((prev) => prev.map((b) => (b.provider === 'vkvideo' ? { ...b, enabled: true } : b)));
          await api.patch('/streamer/bots/vkvideo', { enabled: true, vkvideoChannelUrl: url });
        }

        setVkvideoNotAvailable(false);
        toast.success(t('admin.saved', { defaultValue: 'Saved.' }));
        void loadBotIntegrations();
      } catch (error: unknown) {
        void loadBotIntegrations();
        const apiError = error as {
          response?: { status?: number; data?: { error?: string; channels?: string[] } };
        };
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
        const maybeUrlRequired = await isVkvideoChannelUrlRequiredError(error);
        if (maybeUrlRequired) {
          setVkvideoUrlModalRequestId(maybeUrlRequired.requestId);
          setVkvideoUrlModalOpen(true);
          return;
        }
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
    [
      isVkvideoChannelUrlRequiredError,
      loadBotIntegrations,
      loadVkvideoCandidates,
      t,
      vkvideoCandidates,
      vkvideoCandidatesLoading,
      vkvideoCandidatesNotLinked,
      vkvideoChannelUrl,
    ]
  );

  const enableVkvideoWithSelectedChannel = useCallback(async () => {
    const channel = vkvideoSelectedChannel.trim();
    if (!channel) return;
    const startedAt = Date.now();
    try {
      setBotIntegrationToggleLoading('vkvideo');
      const { api } = await import('@/lib/api');
      const channelUrl = vkvideoChannelUrl.trim();
      await api.patch('/streamer/bots/vkvideo', { enabled: true, vkvideoChannelId: channel, ...(channelUrl ? { vkvideoChannelUrl: channelUrl } : {}) });
      toast.success(t('admin.saved', { defaultValue: 'Saved.' }));
      setVkvideoChannels(null);
      void loadBotIntegrations();
    } catch (error: unknown) {
      const apiError = error as { response?: { data?: { error?: string; message?: string } } };
      try {
        const { getRequestIdFromError } = await import('@/lib/api');
        const rid = getRequestIdFromError(error);
        const msg = apiError.response?.data?.error || apiError.response?.data?.message || t('admin.failedToSave', { defaultValue: 'Failed to save.' });
        toast.error(rid ? `${msg} (${t('common.errorId', { defaultValue: 'Error ID' })}: ${rid})` : msg);
      } catch {
        toast.error(apiError.response?.data?.error || t('admin.failedToSave', { defaultValue: 'Failed to save.' }));
      }
    } finally {
      await ensureMinDuration(startedAt, 450);
      setBotIntegrationToggleLoading(null);
    }
  }, [loadBotIntegrations, t, vkvideoChannelUrl, vkvideoSelectedChannel]);

  const enableVkvideoWithSelectedCandidate = useCallback(async () => {
    const url = vkvideoSelectedCandidateUrl.trim();
    if (!url) return;
    const startedAt = Date.now();
    try {
      setBotIntegrationToggleLoading('vkvideo');
      // optimistic
      setBots((prev) => prev.map((b) => (b.provider === 'vkvideo' ? { ...b, enabled: true } : b)));
      const { api } = await import('@/lib/api');
      await api.patch('/streamer/bots/vkvideo', { enabled: true, vkvideoChannelUrl: url });
      toast.success(t('admin.saved', { defaultValue: 'Saved.' }));
      void loadBotIntegrations();
    } catch (error: unknown) {
      const apiError = error as { response?: { data?: { error?: string; message?: string } } };
      const { getRequestIdFromError } = await import('@/lib/api');
      const rid = getRequestIdFromError(error);
      const msg =
        apiError.response?.data?.error ||
        apiError.response?.data?.message ||
        t('admin.failedToSave', { defaultValue: 'Failed to save.' });
      toast.error(rid ? `${msg} (${t('common.errorId', { defaultValue: 'Error ID' })}: ${rid})` : msg);
      void loadBotIntegrations();
    } finally {
      await ensureMinDuration(startedAt, 450);
      setBotIntegrationToggleLoading(null);
    }
  }, [loadBotIntegrations, t, vkvideoSelectedCandidateUrl]);

  const confirmEnableVkvideoWithUrl = useCallback(async () => {
    const url = vkvideoChannelUrl.trim();
    if (!url) {
      toast.error(
        t('admin.vkvideoChannelUrlRequired', {
          defaultValue: 'Вставьте ссылку на канал VKVideo Live.',
        })
      );
      return;
    }
    const startedAt = Date.now();
    try {
      setVkvideoUrlModalBusy(true);
      setBotIntegrationToggleLoading('vkvideo');
      const { api } = await import('@/lib/api');
      const channelId = vkvideoEnableMode === 'manual' ? vkvideoChannelId.trim() : '';
      await api.patch('/streamer/bots/vkvideo', {
        enabled: true,
        vkvideoChannelUrl: url,
        ...(channelId ? { vkvideoChannelId: channelId } : {}),
      });
      setVkvideoUrlModalOpen(false);
      setVkvideoUrlModalRequestId(null);
      toast.success(t('admin.saved', { defaultValue: 'Saved.' }));
      void loadBotIntegrations();
    } catch (error: unknown) {
      const apiError = error as { response?: { data?: { error?: string; message?: string } } };
      const { getRequestIdFromError } = await import('@/lib/api');
      const rid = getRequestIdFromError(error);
      const msg =
        apiError.response?.data?.error || apiError.response?.data?.message || t('admin.failedToSave', { defaultValue: 'Failed to save.' });
      toast.error(rid ? `${msg} (${t('common.errorId', { defaultValue: 'Error ID' })}: ${rid})` : msg);
    } finally {
      await ensureMinDuration(startedAt, 450);
      setVkvideoUrlModalBusy(false);
      setBotIntegrationToggleLoading(null);
    }
  }, [loadBotIntegrations, t, vkvideoChannelId, vkvideoChannelUrl, vkvideoEnableMode]);

  const callToggle = async (nextEnabled: boolean) => {
    const startedAt = Date.now();
    try {
      if (!twitchLinked) {
        toast.error(t('admin.twitchChannelNotLinked', { defaultValue: 'This channel is not linked to Twitch.' }));
        return;
      }
      // Clear previous hint on any new attempt.
      setTwitchBotNotConfiguredHint(false);
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
                defaultValue: 'Ожидаем доставку ботом… Если долго не меняется — отправьте Outbox ID в поддержку.',
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
      <ConfirmDialog
        isOpen={subscriptionRequiredModalOpen}
        onClose={() => {
          setSubscriptionRequiredModalOpen(false);
          setSubscriptionRequiredModalProvider(null);
        }}
        onConfirm={() => {
          setSubscriptionRequiredModalOpen(false);
          const url = billingUrl;
          setSubscriptionRequiredModalProvider(null);
          if (url) window.open(url, '_blank', 'noopener,noreferrer');
        }}
        title={t('subscription.requiredTitle', { defaultValue: 'Нужна подписка' })}
        message={
          <div className="space-y-2">
            <div className="text-sm">
              {t('subscription.requiredBody', {
                defaultValue: 'Подключение “своего бота” доступно только по подписке.',
              })}
            </div>
            {subscriptionRequiredModalProvider ? (
              <div className="text-xs text-gray-600 dark:text-gray-300">
                {t('subscription.provider', { defaultValue: 'Провайдер' })}: <span className="font-mono">{subscriptionRequiredModalProvider}</span>
              </div>
            ) : null}
          </div>
        }
        confirmText={billingUrl ? t('subscription.goToBilling', { defaultValue: 'Перейти к оплате' }) : t('common.close', { defaultValue: 'Закрыть' })}
        cancelText={t('common.close', { defaultValue: 'Закрыть' })}
        confirmButtonClass="bg-primary hover:bg-primary/90"
      />

      <h2 className="text-2xl font-bold mb-2 dark:text-white">{t('admin.botTitle', { defaultValue: 'Bot' })}</h2>
      <p className="text-sm text-gray-600 dark:text-gray-300 mb-5">
        {t('admin.botDescription', {
          defaultValue:
            'Enable/disable the chat bot subscription for your channel. The bot joins/leaves chats automatically based on this setting.',
        })}
      </p>

      {oauthSubscriptionRequiredBanner ? (
        <div className="mb-4 rounded-xl border border-amber-200/60 dark:border-amber-300/20 bg-amber-50/80 dark:bg-amber-900/10 p-3">
          <div className="text-sm text-amber-900 dark:text-amber-100 font-semibold">
            {t('subscription.oauthSubscriptionRequiredTitle', { defaultValue: 'Нужна подписка' })}
          </div>
          <div className="mt-1 text-sm text-amber-900/90 dark:text-amber-100/90">
            {t('subscription.oauthSubscriptionRequiredBody', {
              defaultValue:
                'Аккаунт привязан, но использовать его как bot sender для канала можно только по подписке.',
            })}
            <span className="ml-2 opacity-80">
              {t('subscription.provider', { defaultValue: 'Провайдер' })}: <span className="font-mono">{oauthSubscriptionRequiredBanner.provider}</span>
            </span>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {billingUrl ? (
              <Button
                type="button"
                variant="primary"
                onClick={() => {
                  window.open(billingUrl, '_blank', 'noopener,noreferrer');
                }}
              >
                {t('subscription.goToBilling', { defaultValue: 'Перейти к оплате' })}
              </Button>
            ) : null}
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setOauthSubscriptionRequiredBanner(null);
              }}
            >
              {t('common.close', { defaultValue: 'Закрыть' })}
            </Button>
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2 mb-4">
        <button
          type="button"
          onClick={() => {
            setBotTab('twitch');
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
          {/* Twitch override bot */}
          <div className="glass p-4 mb-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="font-semibold text-gray-900 dark:text-white">
                  {t('admin.twitchOverrideTitle', { defaultValue: 'Свой Twitch бот (override)' })}
                </div>
                <div className="text-sm text-gray-600 dark:text-gray-300 mt-1">
                  {twitchOverrideLoading ? (
                    t('common.loading', { defaultValue: 'Loading…' })
                  ) : twitchOverrideStatus?.enabled ? (
                    <>
                      {t('admin.twitchOverrideOn', { defaultValue: 'Используется ваш бот' })}
                      {isOverrideConnectedButLocked(twitchOverrideStatus) ? (
                        <span className="ml-2 text-xs font-semibold text-amber-800 dark:text-amber-200">
                          {t('subscription.lockedBySubscription', { defaultValue: 'Заблокировано подпиской' })}
                        </span>
                      ) : null}
                      {twitchOverrideStatus.updatedAt ? (
                        <span className="ml-2 opacity-80">
                          {t('admin.updatedAt', { defaultValue: 'Updated' })}: {new Date(twitchOverrideStatus.updatedAt).toLocaleString()}
                        </span>
                      ) : null}
                    </>
                  ) : (
                    t('admin.twitchOverrideOff', {
                      defaultValue: 'Используется дефолтный бот MemAlerts (если настроен админом)',
                    })
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {twitchOverrideStatus?.enabled ? (
                  <>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => void preflightAndRedirectToOverrideLink('twitch')}
                      disabled={twitchOverrideBusy || isCustomBotConnectLocked}
                    >
                      {t('admin.twitchOverrideRelink', { defaultValue: 'Перепривязать' })}
                    </Button>
                    <Button type="button" variant="secondary" onClick={() => void disconnectTwitchOverride()} disabled={twitchOverrideBusy}>
                      {t('admin.twitchOverrideDisconnect', { defaultValue: 'Отключить' })}
                    </Button>
                  </>
                ) : (
                  <Button
                    type="button"
                    variant="primary"
                    onClick={() => void preflightAndRedirectToOverrideLink('twitch')}
                    disabled={twitchOverrideBusy || isCustomBotConnectLocked}
                  >
                    {t('admin.twitchOverrideConnect', { defaultValue: 'Подключить своего бота' })}
                  </Button>
                )}
              </div>
            </div>
            {isCustomBotConnectLocked ? (
              <div className="mt-2 text-xs text-amber-800 dark:text-amber-200">
                {t('subscription.availableOnlyWithSubscription', { defaultValue: 'Доступно только по подписке' })}
              </div>
            ) : null}
          </div>

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

            {twitchBotNotConfiguredHint && (
              <div className="mt-2 text-xs text-amber-800 dark:text-amber-200">
                {t('admin.twitchBotNotConfiguredHint', {
                  defaultValue: 'Нужен отправитель сообщений: подключите своего бота или попросите админа подключить дефолтного.',
                })}
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
                      void sendTestMessage('twitch');
                    }}
                    disabled={sendingTestMessage}
                  >
                    {t('admin.sendTestMessage', { defaultValue: 'Send test message' })}
                  </Button>
                  {renderOutboxStatus('twitch')}
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
          {/* YouTube override bot */}
          <div className="glass p-4 mb-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="font-semibold text-gray-900 dark:text-white">
                  {t('admin.youtubeOverrideTitle', { defaultValue: 'Свой бот (override)' })}
                </div>
                <div className="text-sm text-gray-600 dark:text-gray-300 mt-1">
                  {youtubeOverrideLoading ? (
                    t('common.loading', { defaultValue: 'Loading…' })
                  ) : youtubeOverrideStatus?.enabled ? (
                    <>
                      {t('admin.youtubeOverrideOn', { defaultValue: 'Используется ваш бот' })}
                      {isOverrideConnectedButLocked(youtubeOverrideStatus) ? (
                        <span className="ml-2 text-xs font-semibold text-amber-800 dark:text-amber-200">
                          {t('subscription.lockedBySubscription', { defaultValue: 'Заблокировано подпиской' })}
                        </span>
                      ) : null}
                      {youtubeOverrideStatus.updatedAt ? (
                        <span className="ml-2 opacity-80">
                          {t('admin.updatedAt', { defaultValue: 'Updated' })}: {new Date(youtubeOverrideStatus.updatedAt).toLocaleString()}
                        </span>
                      ) : null}
                    </>
                  ) : (
                    t('admin.youtubeOverrideOff', {
                      defaultValue: 'Используется дефолтный бот MemAlerts (если настроен админом)',
                    })
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {youtubeOverrideStatus?.enabled ? (
                  <>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => void preflightAndRedirectToOverrideLink('youtube')}
                      disabled={youtubeOverrideBusy || isCustomBotConnectLocked}
                    >
                      {t('admin.youtubeOverrideRelink', { defaultValue: 'Перепривязать' })}
                    </Button>
                    <Button type="button" variant="secondary" onClick={() => void disconnectYoutubeOverride()} disabled={youtubeOverrideBusy}>
                      {t('admin.youtubeOverrideDisconnect', { defaultValue: 'Отключить' })}
                    </Button>
                  </>
                ) : (
                  <Button
                    type="button"
                    variant="primary"
                    onClick={() => void preflightAndRedirectToOverrideLink('youtube')}
                    disabled={youtubeOverrideBusy || isCustomBotConnectLocked}
                  >
                    {t('admin.youtubeOverrideConnect', { defaultValue: 'Подключить своего бота' })}
                  </Button>
                )}
              </div>
            </div>
            {isCustomBotConnectLocked ? (
              <div className="mt-2 text-xs text-amber-800 dark:text-amber-200">
                {t('subscription.availableOnlyWithSubscription', { defaultValue: 'Доступно только по подписке' })}
              </div>
            ) : null}
          </div>
          {/* YouTube integration */}
          <div className="glass p-4 mb-4 relative">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="font-semibold text-gray-900 dark:text-white">YouTube</div>
                <div className="text-sm text-gray-600 dark:text-gray-300 mt-1">
                  {t('admin.youtubeBotIntegrationHint', {
                    defaultValue:
                      'Для отправки сообщений ботом нужен scope https://www.googleapis.com/auth/youtube.force-ssl. Если YouTube был привязан раньше — потребуется перелинковка.',
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
                      startStreamerYoutubeAccountRelink();
                    }}
                  >
                    {t('admin.youtubeRelinkStreamerCta', { defaultValue: 'Перепривязать YouTube (аккаунт стримера)' })}
                  </Button>
                </div>
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
                  void sendTestMessage('youtube');
                }}
                disabled={sendingTestMessage}
              >
                {t('admin.sendTestMessage', { defaultValue: 'Send test message' })}
              </Button>
              {renderOutboxStatus('youtube')}
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
          <ConfirmDialog
            isOpen={vkvideoUrlModalOpen}
            onClose={() => {
              if (vkvideoUrlModalBusy) return;
              setVkvideoUrlModalOpen(false);
              setVkvideoUrlModalRequestId(null);
            }}
            onConfirm={() => void confirmEnableVkvideoWithUrl()}
            title={t('admin.vkvideoChannelUrlModalTitle', { defaultValue: 'Нужна ссылка на канал VKVideo Live' })}
            message={
              <div className="space-y-3">
                <div className="text-sm">
                  {t('admin.vkvideoChannelUrlModalBody', {
                    defaultValue:
                      'Не удалось автоматически определить vkvideoChannelUrl. Вставьте ссылку на ваш канал VKVideo Live и нажмите “Сохранить”.',
                  })}
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 dark:text-gray-200 mb-1">
                    {t('admin.vkvideoChannelUrlLabel', { defaultValue: 'VKVideo channel URL' })}
                  </label>
                  <Input
                    value={vkvideoChannelUrl}
                    onChange={(e) => setVkvideoChannelUrl(e.target.value)}
                    placeholder={t('admin.vkvideoChannelUrlPlaceholder', { defaultValue: 'https://vkvideo.ru/@your_channel' })}
                    disabled={vkvideoUrlModalBusy}
                  />
                  <div className="mt-1 text-[11px] text-gray-600 dark:text-gray-300">
                    {t('admin.vkvideoChannelUrlHelp', {
                      defaultValue:
                        'Требуется для VKVideo Live DevAPI. Если вы включали VKVideo раньше обновления — выключите и включите заново, чтобы URL сохранился на сервере.',
                    })}
                  </div>
                </div>
                {vkvideoUrlModalRequestId ? (
                  <div className="text-xs text-gray-600 dark:text-gray-300">
                    {t('common.errorId', { defaultValue: 'Error ID' })}: <span className="font-mono">{vkvideoUrlModalRequestId}</span>
                  </div>
                ) : null}
              </div>
            }
            confirmText={t('common.save', { defaultValue: 'Save' })}
            cancelText={t('common.close', { defaultValue: 'Закрыть' })}
            confirmButtonClass="bg-primary hover:bg-primary/90"
            isLoading={vkvideoUrlModalBusy}
          />
          {/* VKVideo override bot */}
          <div className="glass p-4 mb-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="font-semibold text-gray-900 dark:text-white">
                  {t('admin.vkvideoOverrideTitle', { defaultValue: 'Свой VKVideo бот (override)' })}
                </div>
                <div className="text-sm text-gray-600 dark:text-gray-300 mt-1">
                  {vkvideoOverrideLoading ? (
                    t('common.loading', { defaultValue: 'Loading…' })
                  ) : vkvideoOverrideStatus?.enabled ? (
                    <>
                      {t('admin.vkvideoOverrideOn', { defaultValue: 'Используется ваш бот' })}
                      {isOverrideConnectedButLocked(vkvideoOverrideStatus) ? (
                        <span className="ml-2 text-xs font-semibold text-amber-800 dark:text-amber-200">
                          {t('subscription.lockedBySubscription', { defaultValue: 'Заблокировано подпиской' })}
                        </span>
                      ) : null}
                      {vkvideoOverrideStatus.updatedAt ? (
                        <span className="ml-2 opacity-80">
                          {t('admin.updatedAt', { defaultValue: 'Updated' })}: {new Date(vkvideoOverrideStatus.updatedAt).toLocaleString()}
                        </span>
                      ) : null}
                    </>
                  ) : (
                    t('admin.vkvideoOverrideOff', {
                      defaultValue: 'Используется дефолтный бот MemAlerts (если настроен админом)',
                    })
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {vkvideoOverrideStatus?.enabled ? (
                  <>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => void preflightAndRedirectToOverrideLink('vkvideo')}
                      disabled={vkvideoOverrideBusy || isCustomBotConnectLocked}
                    >
                      {t('admin.vkvideoOverrideRelink', { defaultValue: 'Перепривязать' })}
                    </Button>
                    <Button type="button" variant="secondary" onClick={() => void disconnectVkvideoOverride()} disabled={vkvideoOverrideBusy}>
                      {t('admin.vkvideoOverrideDisconnect', { defaultValue: 'Отключить' })}
                    </Button>
                  </>
                ) : (
                  <Button
                    type="button"
                    variant="primary"
                    onClick={() => void preflightAndRedirectToOverrideLink('vkvideo')}
                    disabled={vkvideoOverrideBusy || isCustomBotConnectLocked}
                  >
                    {t('admin.vkvideoOverrideConnect', { defaultValue: 'Подключить своего бота' })}
                  </Button>
                )}
              </div>
            </div>
            {isCustomBotConnectLocked ? (
              <div className="mt-2 text-xs text-amber-800 dark:text-amber-200">
                {t('subscription.availableOnlyWithSubscription', { defaultValue: 'Доступно только по подписке' })}
              </div>
            ) : null}
          </div>
          {/* VKVideo integration */}
          <div className="glass p-4 mb-4 relative">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="font-semibold text-gray-900 dark:text-white">VK Video Live</div>
                <div className="text-sm text-gray-600 dark:text-gray-300 mt-1">
                  {vkvideoNotAvailable
                    ? t('admin.featureNotAvailableShort', { defaultValue: 'Not available on this server.' })
                    : t('admin.vkvideoBotIntegrationHint', {
                        defaultValue:
                          "Сначала привяжите VKVideo в 'Accounts', затем включите бота. Если каналов несколько — выберите один; если не нашли — вставьте ссылку на канал.",
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

            {!vkEnabled ? (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
                <span className="opacity-80">
                  {vkvideoCandidatesLoading
                    ? t('common.loading', { defaultValue: 'Loading…' })
                    : t('admin.vkvideoCandidatesHint', {
                        defaultValue: 'Перед включением мы попробуем найти ваши VKVideo каналы.',
                      })}
                </span>
                <button
                  type="button"
                  className="underline hover:no-underline"
                  disabled={vkvideoCandidatesLoading}
                  onClick={() => void loadVkvideoCandidates()}
                >
                  {t('admin.refresh', { defaultValue: 'Refresh' })}
                </button>
                {vkvideoCandidatesNotLinked ? (
                  <span className="text-amber-800 dark:text-amber-200">
                    {t('admin.vkvideoNotLinked', { defaultValue: "Сначала привяжите VKVideo в 'Accounts'." })}
                  </span>
                ) : null}
              </div>
            ) : null}

            {vkEnabled && typeof vk?.vkvideoChannelUrl === 'string' && !vk.vkvideoChannelUrl.trim() ? (
              <div className="mt-2 text-xs text-amber-800 dark:text-amber-200">
                {t('admin.vkvideoMigrationHint', {
                  defaultValue:
                    'VKVideo был включён до обновления и vkvideoChannelUrl мог не сохраниться. Выключите → включите VKVideo, чтобы сервер сохранил URL канала.',
                })}
              </div>
            ) : null}

            {Array.isArray(vkvideoCandidates) && vkvideoCandidates.length > 1 && !vkEnabled ? (
              <div className="mt-3 rounded-lg bg-amber-50/70 dark:bg-amber-900/20 ring-1 ring-amber-200/60 dark:ring-amber-700/40 px-3 py-2">
                <div className="text-xs font-semibold text-amber-900 dark:text-amber-100">
                  {t('admin.vkvideoCandidatesTitle', { defaultValue: 'Выберите канал VKVideo' })}
                </div>
                <div className="mt-1 text-xs text-amber-900/90 dark:text-amber-100/90">
                  {t('admin.vkvideoCandidatesPickHint', {
                    defaultValue: 'Найдены кандидаты. Выберите URL канала и нажмите “Включить”.',
                  })}
                </div>
                <div className="mt-2 flex flex-col sm:flex-row gap-2 sm:items-center">
                  <select
                    className="flex-1 rounded-lg bg-white/80 dark:bg-white/5 ring-1 ring-black/10 dark:ring-white/10 px-3 py-2 text-sm text-gray-900 dark:text-white"
                    value={vkvideoSelectedCandidateUrl}
                    onChange={(e) => setVkvideoSelectedCandidateUrl(e.target.value)}
                    disabled={vkBusy}
                  >
                    {vkvideoCandidates.map((c) => (
                      <option key={c.url} value={c.url}>
                        {c.url}
                      </option>
                    ))}
                  </select>
                  <Button
                    type="button"
                    variant="primary"
                    onClick={() => void enableVkvideoWithSelectedCandidate()}
                    disabled={vkBusy || !vkvideoSelectedCandidateUrl.trim()}
                  >
                    {t('admin.enable', { defaultValue: 'Enable' })}
                  </Button>
                </div>
              </div>
            ) : null}

            <div className="mt-3">
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-200 mb-1">
                {t('admin.vkvideoChannelUrlLabel', { defaultValue: 'VKVideo channel URL' })}
              </label>
              <Input
                value={vkvideoChannelUrl}
                onChange={(e) => setVkvideoChannelUrl(e.target.value)}
                placeholder={t('admin.vkvideoChannelUrlPlaceholder', { defaultValue: 'https://vkvideo.ru/@your_channel' })}
                disabled={!botsLoaded || botsLoading || vkvideoNotAvailable || vkBusy || vkEnabled}
              />
              <div className="mt-1 text-[11px] text-gray-600 dark:text-gray-300">
                {t('admin.vkvideoChannelUrlHelp', {
                  defaultValue:
                    'URL канала нужен для VKVideo Live DevAPI. Бэкенд попробует определить его сам из привязанного VKVideo аккаунта, но если не получится — попросит вставить ссылку.',
                })}
              </div>
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
                  void sendTestMessage('vkvideo');
                }}
                disabled={sendingTestMessage}
              >
                {t('admin.sendTestMessage', { defaultValue: 'Send test message' })}
              </Button>
              {renderOutboxStatus('vkvideo')}
              {lastOutbox?.provider === 'vkvideo' && String(lastOutbox.status || '').toLowerCase() === 'pending' ? (
                <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                  {t('admin.vkvideoOutboxPendingHint', {
                    defaultValue:
                      'pending = сообщение в очереди. Если раннер/консьюмер на сервере не запущен или не подключён к чату — сообщение не появится.',
                  })}
                </div>
              ) : null}
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


