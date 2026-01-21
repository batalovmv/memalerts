import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

import type { BotCommand } from '../types';
import { useBotTriggers } from './useBotTriggers';

import { ensureMinDuration } from '@/shared/lib/ensureMinDuration';

type UseBotCommandsOptions = {
  showMenus: boolean;
};

export const useBotCommands = ({ showMenus }: UseBotCommandsOptions) => {
  const { t } = useTranslation();

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
  const triggers = useBotTriggers({ showMenus });

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

  useEffect(() => {
    if (!showMenus) return;
    if (!commandsLoaded && !commandsLoading) void loadCommands();
  }, [commandsLoaded, commandsLoading, loadCommands, showMenus]);

  const visibleCommands = useMemo(() => [...commands].sort((a, b) => a.trigger.localeCompare(b.trigger)), [commands]);
  const anyCommandEnabled = useMemo(() => visibleCommands.some((c) => c.enabled !== false), [visibleCommands]);
  const allCommandsLiveOnly = useMemo(() => {
    if (visibleCommands.length === 0) return false;
    return visibleCommands.every((c) => c.onlyWhenLive === true);
  }, [visibleCommands]);

  useEffect(() => {
    if (!showMenus) return;
    if (!commandsLoaded) return;
    setCommandsOpen(anyCommandEnabled);
  }, [anyCommandEnabled, commandsLoaded, showMenus]);

  useEffect(() => {
    if (!showMenus) return;
    if (!commandsLoaded) return;
    setCommandsOnlyWhenLive(allCommandsLiveOnly);
  }, [allCommandsLiveOnly, commandsLoaded, showMenus]);

  const normalizeUserList = useCallback((raw: string): string[] => {
    const items = raw
      .split(/[\s,;]+/g)
      .map((v) => v.trim())
      .filter(Boolean)
      .map((v) => v.replace(/^@/, '').toLowerCase());
    return Array.from(new Set(items));
  }, []);

  const formatUserList = useCallback((users: string[] | undefined | null): string => {
    if (!Array.isArray(users) || users.length === 0) return '';
    return users
      .map((u) => u.trim())
      .filter(Boolean)
      .join(', ');
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
          t('admin.botCommandsNotAvailable', {
            defaultValue: 'Commands are not available on this server yet. Please deploy the backend update.',
          })
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
        setCommands((list) => list.map((c) => (c.id === id ? { ...c, ...patch } : c)));

        const { api } = await import('@/lib/api');
        const res = await api.patch<BotCommand>(`/streamer/bot/commands/${encodeURIComponent(id)}`, patch);
        if (res && typeof res === 'object' && 'id' in res) {
          const updated = res as BotCommand;
          setCommands((prevCommands) => prevCommands.map((c) => (c.id === id ? { ...c, ...updated } : c)));
        }
      } catch (error: unknown) {
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

  const toggleAllCommands = useCallback(
    async (next: boolean) => {
      setCommandsOpen(next);
      const startedAt = Date.now();
      try {
        setSavingCommandsBulk(true);

        if (!next) {
          lastCommandsEnabledMapRef.current = Object.fromEntries(commands.map((c) => [c.id, c.enabled !== false]));
          for (const c of commands) {
            if (c.enabled !== false) {
              await updateCommand(c.id, { enabled: false });
            }
          }
          return;
        }

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
    },
    [commands, updateCommand]
  );

  const toggleCommandsOnlyWhenLive = useCallback(
    async (next: boolean) => {
      const startedAt = Date.now();
      try {
        setSavingCommandsBulk(true);
        setCommandsOnlyWhenLive(next);
        for (const c of commands) {
          if ((c.onlyWhenLive === true) !== next) {
            await updateCommand(c.id, { onlyWhenLive: next });
          }
        }
      } finally {
        await ensureMinDuration(startedAt, 450);
        setSavingCommandsBulk(false);
      }
    },
    [commands, updateCommand]
  );

  return {
    commands,
    commandsLoaded,
    commandsLoading,
    commandsNotAvailable,
    commandToggleLoadingId,
    commandsOpen,
    setCommandsOpen,
    newTrigger,
    setNewTrigger,
    newResponse,
    setNewResponse,
    commandsOnlyWhenLive,
    setCommandsOnlyWhenLive,
    newAllowedRoles,
    setNewAllowedRoles,
    newAllowedUsers,
    setNewAllowedUsers,
    savingCommandsBulk,
    editingAudienceId,
    setEditingAudienceId,
    audienceDraftRoles,
    setAudienceDraftRoles,
    audienceDraftUsers,
    setAudienceDraftUsers,
    visibleCommands,
    anyCommandEnabled,
    allCommandsLiveOnly,
    loadCommands,
    addCommand,
    updateCommand,
    deleteCommand,
    normalizeUserList,
    formatUserList,
    toggleAllCommands,
    toggleCommandsOnlyWhenLive,
    ...triggers,
  };
};

export type UseBotCommandsResult = ReturnType<typeof useBotCommands>;
