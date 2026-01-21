import { useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

import type { StreamDurationSettings } from '../types';

import { ensureMinDuration } from '@/shared/lib/ensureMinDuration';

type UseBotTriggersOptions = {
  showMenus: boolean;
};

export const useBotTriggers = ({ showMenus }: UseBotTriggersOptions) => {
  const { t } = useTranslation();

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
    const TTL_MS = 10_000;
    const cacheKey = 'memalerts:botSettings:followGreetings';
    try {
      const raw = sessionStorage.getItem(cacheKey);
      if (raw) {
        const parsed = JSON.parse(raw) as { at?: unknown; followGreetingsEnabled?: unknown; followGreetingTemplate?: unknown };
        const at = typeof parsed?.at === 'number' ? parsed.at : 0;
        if (at > 0 && Date.now() - at < TTL_MS) {
          if (typeof parsed.followGreetingsEnabled === 'boolean') setFollowGreetingsEnabled(parsed.followGreetingsEnabled);
          if (typeof parsed.followGreetingTemplate === 'string') setFollowGreetingTemplate(parsed.followGreetingTemplate);
          return;
        }
      }
    } catch {
      // ignore cache
    }
    try {
      const { api } = await import('@/lib/api');
      const res = await api.get<{ followGreetingsEnabled?: boolean; followGreetingTemplate?: string | null }>(
        '/streamer/bot/follow-greetings',
        { timeout: 8000 }
      );
      if (typeof res?.followGreetingsEnabled === 'boolean') setFollowGreetingsEnabled(res.followGreetingsEnabled);
      if (typeof res?.followGreetingTemplate === 'string') setFollowGreetingTemplate(res.followGreetingTemplate);
      try {
        sessionStorage.setItem(
          cacheKey,
          JSON.stringify({
            at: Date.now(),
            followGreetingsEnabled: typeof res?.followGreetingsEnabled === 'boolean' ? res.followGreetingsEnabled : undefined,
            followGreetingTemplate: typeof res?.followGreetingTemplate === 'string' ? res.followGreetingTemplate : undefined,
          })
        );
      } catch {
        // ignore cache write
      }
    } catch (error: unknown) {
      const apiError = error as { response?: { status?: number } };
      if (apiError.response?.status === 404) return;
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
      setStreamDurationLoaded(false);
    }
  }, []);

  useEffect(() => {
    void loadFollowGreetings();
  }, [loadFollowGreetings]);

  useEffect(() => {
    if (!showMenus) return;
    if (streamDurationLoaded || streamDurationNotAvailable) return;
    void loadStreamDuration();
  }, [loadStreamDuration, showMenus, streamDurationLoaded, streamDurationNotAvailable]);

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

  const saveStreamDuration = useCallback(
    async (override?: { enabled?: boolean }) => {
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
    },
    [streamDurationBreakCreditMinutes, streamDurationEnabled, streamDurationTemplate, streamDurationTrigger, t]
  );

  const toggleStreamDurationEnabled = useCallback(
    async (nextEnabled: boolean) => {
      setStreamDurationEnabled(nextEnabled);
      setStreamDurationOpen(nextEnabled);
      void saveStreamDuration({ enabled: nextEnabled });
    },
    [saveStreamDuration]
  );

  useEffect(() => {
    if (!showMenus) return;
    if (!followGreetingsEnabled) return;
    const trimmed = followGreetingTemplate.trim();
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

  return {
    followGreetingsEnabled,
    followGreetingTemplate,
    setFollowGreetingTemplate,
    savingFollowGreetings,
    enableFollowGreetings,
    disableFollowGreetings,
    streamDurationLoaded,
    streamDurationNotAvailable,
    savingStreamDuration,
    streamDurationEnabled,
    streamDurationTrigger,
    setStreamDurationTrigger,
    streamDurationTemplate,
    setStreamDurationTemplate,
    streamDurationBreakCreditMinutes,
    setStreamDurationBreakCreditMinutes,
    streamDurationOpen,
    setStreamDurationOpen,
    toggleStreamDurationEnabled,
    saveStreamDuration,
  };
};

export type UseBotTriggersResult = ReturnType<typeof useBotTriggers>;
