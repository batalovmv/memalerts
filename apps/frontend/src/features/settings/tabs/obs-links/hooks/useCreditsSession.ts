import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

import {
  getCreditsState,
  getIgnoredChatters,
  getReconnectWindow,
  resetCreditsSession as resetCreditsSessionApi,
  setIgnoredChatters,
  setReconnectWindow,
} from '@/shared/api/creditsOverlay';
import { ensureMinDuration } from '@/shared/lib/ensureMinDuration';

export type CreditsSessionState = ReturnType<typeof useCreditsSession>;

type CreditsSessionArgs = {
  channelSlug: string;
  overlayKind: 'memes' | 'credits';
  socket: {
    on: (event: string, cb: (payload?: unknown) => void) => void;
    off: (event: string, cb: (payload?: unknown) => void) => void;
    emit: (event: string, payload?: unknown) => void;
  } | null;
  isConnected: boolean;
};

export function useCreditsSession({ channelSlug, overlayKind, socket, isConnected }: CreditsSessionArgs) {
  const { t } = useTranslation();

  // Credits session state (viewers/chatters, reconnect window, ignore list)
  const [creditsChannelSlug, setCreditsChannelSlug] = useState<string>('');
  const [creditsChatters, setCreditsChatters] = useState<Array<{ name: string; messageCount?: number }>>([]);
  const [loadingCreditsState, setLoadingCreditsState] = useState(false);
  const [resettingCredits, setResettingCredits] = useState(false);

  const [creditsReconnectWindowMinutes, setCreditsReconnectWindowMinutes] = useState<number | null>(null);
  const [creditsReconnectWindowInput, setCreditsReconnectWindowInput] = useState<string>('');
  const [savingReconnectWindow, setSavingReconnectWindow] = useState(false);

  const [creditsIgnoredChatters, setCreditsIgnoredChatters] = useState<string[]>([]);
  const [creditsIgnoredChattersText, setCreditsIgnoredChattersText] = useState<string>('');
  const [loadingIgnoredChatters, setLoadingIgnoredChatters] = useState(false);
  const [savingIgnoredChatters, setSavingIgnoredChatters] = useState(false);


  const loadCreditsState = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!channelSlug) return;
      if (!opts?.silent) setLoadingCreditsState(true);
      try {
        const resp = await getCreditsState();
        const respAny = resp as Record<string, unknown>;
        const slug =
          typeof respAny.channelSlug === 'string'
            ? String(respAny.channelSlug || '').trim()
            : String(channelSlug || '').trim();
        if (slug) setCreditsChannelSlug(slug);
        const chattersRaw = Array.isArray(resp?.chatters) ? resp.chatters : [];
        const normalizedChatters = chattersRaw
          .map((c) => {
            const name = String(
              (c as { displayName?: unknown })?.displayName ?? (c as { name?: unknown })?.name ?? ''
            )
              .trim();
            if (!name) return null;
            const messageCount =
              typeof (c as { messageCount?: unknown })?.messageCount === 'number'
                ? (c as { messageCount: number }).messageCount
                : undefined;
            return messageCount === undefined ? { name } : { name, messageCount };
          })
          .filter((c): c is { name: string; messageCount?: number } => !!c);
        setCreditsChatters(normalizedChatters);

        // Back-compat: if backend also includes reconnect window in state, use it.
        const reconnectSeconds =
          typeof respAny.reconnectWindowSeconds === 'number'
            ? respAny.reconnectWindowSeconds
            : typeof respAny.creditsReconnectWindowMinutes === 'number'
              ? Math.max(0, Math.round(respAny.creditsReconnectWindowMinutes * 60))
              : null;
        if (typeof reconnectSeconds === 'number' && Number.isFinite(reconnectSeconds)) {
          const minutes = Math.max(0, Math.round(reconnectSeconds / 60));
          setCreditsReconnectWindowMinutes(minutes);
          setCreditsReconnectWindowInput(String(minutes));
        }
      } catch (error: unknown) {
        if (!opts?.silent) {
          const apiError = error as { response?: { data?: { error?: string } } };
          toast.error(apiError.response?.data?.error || t('admin.failedToLoad', { defaultValue: 'Failed to load' }));
        }
      } finally {
        if (!opts?.silent) setLoadingCreditsState(false);
      }
    },
    [channelSlug, t]
  );

  const loadCreditsIgnoredChatters = useCallback(async () => {
    if (!channelSlug) return;
    setLoadingIgnoredChatters(true);
    try {
      const resp = await getIgnoredChatters();
      const list = Array.isArray(resp?.chatters) ? resp.chatters : [];
      const cleaned = list.map((v) => String(v || '').trim()).filter(Boolean);
      setCreditsIgnoredChatters(cleaned);
      setCreditsIgnoredChattersText(cleaned.join('\n'));
    } catch (error: unknown) {
      const err = error as { response?: { status?: number; data?: { error?: string } } };
      if (err?.response?.status !== 404) {
        toast.error(err.response?.data?.error || t('admin.failedToLoad', { defaultValue: 'Failed to load' }));
      }
    } finally {
      setLoadingIgnoredChatters(false);
    }
  }, [channelSlug, t]);

  const loadCreditsReconnectWindow = useCallback(async () => {
    if (!channelSlug) return;
    try {
      const resp = await getReconnectWindow();
      const respAny = resp as Record<string, unknown>;
      const seconds =
        typeof respAny.seconds === 'number'
          ? respAny.seconds
          : typeof respAny.creditsReconnectWindowMinutes === 'number'
            ? Math.round(respAny.creditsReconnectWindowMinutes * 60)
            : null;
      if (typeof seconds === 'number' && Number.isFinite(seconds)) {
        const minutes = Math.max(0, Math.round(seconds / 60));
        setCreditsReconnectWindowMinutes(minutes);
        setCreditsReconnectWindowInput(String(minutes));
      }
    } catch {
      // ignore (back-compat)
    }
  }, [channelSlug]);

  const saveCreditsReconnectWindow = useCallback(async () => {
    const raw = String(creditsReconnectWindowInput || '').trim();
    const minutes = Number(raw);
    if (!Number.isFinite(minutes) || minutes < 0) {
      toast.error(t('admin.invalidValue', { defaultValue: 'Invalid value' }));
      return;
    }

    const startedAt = Date.now();
    setSavingReconnectWindow(true);
    try {
      const seconds = Math.max(0, Math.round(minutes * 60));
      await setReconnectWindow(seconds);
      setCreditsReconnectWindowMinutes(minutes);
      setCreditsReconnectWindowInput(String(minutes));
      toast.success(t('admin.settingsSaved', { defaultValue: 'Saved' }));
    } catch (error: unknown) {
      const apiError = error as { response?: { data?: { error?: string } } };
      toast.error(apiError.response?.data?.error || t('admin.failedToSave', { defaultValue: 'Failed to save' }));
    } finally {
      await ensureMinDuration(startedAt, 450);
      setSavingReconnectWindow(false);
    }
  }, [creditsReconnectWindowInput, t]);

  const resetCreditsSession = useCallback(async () => {
    const confirmed = window.confirm(
      t('admin.creditsResetConfirm', {
        defaultValue: 'Сбросить список зрителей? После этого начнётся новый список для следующей трансляции.',
      })
    );
    if (!confirmed) return;

    const startedAt = Date.now();
    setResettingCredits(true);
    try {
      await resetCreditsSessionApi();
      await loadCreditsState({ silent: true });
      toast.success(t('admin.done', { defaultValue: 'Done' }));
    } catch (error: unknown) {
      const apiError = error as { response?: { data?: { error?: string } } };
      toast.error(apiError.response?.data?.error || t('admin.failedToSave', { defaultValue: 'Failed to save' }));
    } finally {
      await ensureMinDuration(startedAt, 450);
      setResettingCredits(false);
    }
  }, [loadCreditsState, t]);

  const saveCreditsIgnoredChatters = useCallback(async () => {
    const lines = String(creditsIgnoredChattersText || '')
      .split('\n')
      .map((v) => v.trim())
      .filter(Boolean);

    const startedAt = Date.now();
    setSavingIgnoredChatters(true);
    try {
      await setIgnoredChatters(lines);
      const cleaned = lines.map((v) => String(v || '').trim()).filter(Boolean);
      setCreditsIgnoredChatters(cleaned);
      setCreditsIgnoredChattersText(cleaned.join('\n'));
      toast.success(t('admin.settingsSaved', { defaultValue: 'Saved' }));
    } catch (error: unknown) {
      const apiError = error as { response?: { data?: { error?: string } } };
      toast.error(apiError.response?.data?.error || t('admin.failedToSave', { defaultValue: 'Failed to save' }));
    } finally {
      await ensureMinDuration(startedAt, 450);
      setSavingIgnoredChatters(false);
    }
  }, [creditsIgnoredChattersText, t]);

  // Initial credits loads when switching to "Credits" tab.
  useEffect(() => {
    if (!channelSlug) return;
    if (overlayKind !== 'credits') return;
    void loadCreditsState();
    void loadCreditsIgnoredChatters();
    void loadCreditsReconnectWindow();
  }, [channelSlug, loadCreditsIgnoredChatters, loadCreditsReconnectWindow, loadCreditsState, overlayKind]);

  // Live updates via Socket.IO (uses auth cookie).
  useEffect(() => {
    if (!socket || !isConnected) return;
    if (overlayKind !== 'credits') return;
    const slug = String(creditsChannelSlug || channelSlug || '').trim();
    if (!slug) return;

    socket.emit('join:channel', slug);

    const onCreditsState = (payload?: unknown) => {
      const incoming = payload as
        | { chatters?: Array<{ displayName?: string; name?: string; messageCount?: number }> }
        | null
        | undefined;
      const next = Array.isArray(incoming?.chatters) ? incoming!.chatters! : [];
      const normalized = next
        .map((c) => {
          const name = String(c?.displayName ?? c?.name ?? '').trim();
          if (!name) return null;
          const messageCount = typeof c?.messageCount === 'number' ? c.messageCount : undefined;
          return messageCount === undefined ? { name } : { name, messageCount };
        })
        .filter((c): c is { name: string; messageCount?: number } => !!c);
      setCreditsChatters(normalized);
    };

    socket.on('credits:state', onCreditsState);
    return () => {
      socket.off('credits:state', onCreditsState);
    };
  }, [channelSlug, creditsChannelSlug, isConnected, overlayKind, socket]);

  return {
    creditsChannelSlug,
    setCreditsChannelSlug,
    creditsChatters,
    setCreditsChatters,
    loadingCreditsState,
    setLoadingCreditsState,
    resettingCredits,
    setResettingCredits,
    creditsReconnectWindowMinutes,
    setCreditsReconnectWindowMinutes,
    creditsReconnectWindowInput,
    setCreditsReconnectWindowInput,
    savingReconnectWindow,
    setSavingReconnectWindow,
    creditsIgnoredChatters,
    setCreditsIgnoredChatters,
    creditsIgnoredChattersText,
    setCreditsIgnoredChattersText,
    loadingIgnoredChatters,
    setLoadingIgnoredChatters,
    savingIgnoredChatters,
    setSavingIgnoredChatters,
    loadCreditsState,
    loadCreditsIgnoredChatters,
    loadCreditsReconnectWindow,
    saveCreditsReconnectWindow,
    resetCreditsSession,
    saveCreditsIgnoredChatters,
  };
}
