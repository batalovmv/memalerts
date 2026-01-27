import { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

import type { CustomBotEntitlementStatus, OverrideStatus } from '../types';

import { getApiOriginForRedirect } from '@/shared/auth/login';
import { getRuntimeConfig } from '@/shared/config/runtimeConfig';
import { ensureMinDuration } from '@/shared/lib/ensureMinDuration';

type UseBotOverridesOptions = {
  botTab: 'twitch' | 'youtube' | 'vk';
};

export const useBotOverrides = ({ botTab }: UseBotOverridesOptions) => {
  const { t } = useTranslation();

  const [customBotEntitlement, setCustomBotEntitlement] = useState<CustomBotEntitlementStatus>('unknown');
  const [subscriptionRequiredModalOpen, setSubscriptionRequiredModalOpen] = useState(false);
  const [subscriptionRequiredModalProvider, setSubscriptionRequiredModalProvider] = useState<
    'twitch' | 'youtube' | 'vkvideo' | null
  >(null);
  const [oauthSubscriptionRequiredBanner, setOauthSubscriptionRequiredBanner] = useState<{
    provider: 'twitch' | 'youtube' | 'vkvideo';
  } | null>(null);

  const [youtubeOverrideStatus, setYoutubeOverrideStatus] = useState<OverrideStatus | null>(null);
  const [youtubeOverrideLoading, setYoutubeOverrideLoading] = useState(false);
  const [youtubeOverrideBusy, setYoutubeOverrideBusy] = useState(false);
  const [twitchOverrideStatus, setTwitchOverrideStatus] = useState<OverrideStatus | null>(null);
  const [twitchOverrideLoading, setTwitchOverrideLoading] = useState(false);
  const [twitchOverrideBusy, setTwitchOverrideBusy] = useState(false);
  const [vkvideoOverrideStatus, setVkvideoOverrideStatus] = useState<OverrideStatus | null>(null);
  const [vkvideoOverrideLoading, setVkvideoOverrideLoading] = useState(false);
  const [vkvideoOverrideBusy, setVkvideoOverrideBusy] = useState(false);

  const billingUrl = useMemo(() => {
    const v = getRuntimeConfig()?.billingUrl;
    return typeof v === 'string' && v.trim() ? v.trim() : null;
  }, []);

  const showSubscriptionRequiredModal = useCallback((provider: 'twitch' | 'youtube' | 'vkvideo') => {
    setSubscriptionRequiredModalProvider(provider);
    setSubscriptionRequiredModalOpen(true);
  }, []);

  const loadCustomBotEntitlement = useCallback(async () => {
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

  const startStreamerYoutubeAccountRelink = useCallback(() => {
    const apiOrigin = getApiOriginForRedirect();
    const url = new URL(`${apiOrigin}/auth/youtube/link`);
    url.searchParams.set('redirect_to', '/settings/bot/youtube');
    url.searchParams.set('origin', window.location.origin);
    window.location.href = url.toString();
  }, []);

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
      const apiOrigin = getApiOriginForRedirect();
      const redirectTo = provider === 'vkvideo' ? '/settings/bot/vkvideo' : `/settings/bot/${provider}`;
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
    [showSubscriptionRequiredModal]
  );

  const isCustomBotConnectLocked = customBotEntitlement === 'not_entitled';
  const isOverrideConnectedButLocked = useCallback((s: OverrideStatus | null): boolean => {
    return Boolean(s?.enabled && s?.lockedBySubscription);
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
    const confirmed = window.confirm(
      t('admin.twitchOverrideDisconnectConfirm', { defaultValue: 'Отключить вашего Twitch-бота (override)?' })
    );
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

  return {
    billingUrl,
    subscriptionRequiredModalOpen,
    setSubscriptionRequiredModalOpen,
    subscriptionRequiredModalProvider,
    setSubscriptionRequiredModalProvider,
    oauthSubscriptionRequiredBanner,
    setOauthSubscriptionRequiredBanner,
    customBotEntitlement,
    isCustomBotConnectLocked,
    isOverrideConnectedButLocked,
    preflightAndRedirectToOverrideLink,
    startStreamerYoutubeAccountRelink,
    youtubeOverrideStatus,
    youtubeOverrideLoading,
    youtubeOverrideBusy,
    twitchOverrideStatus,
    twitchOverrideLoading,
    twitchOverrideBusy,
    vkvideoOverrideStatus,
    vkvideoOverrideLoading,
    vkvideoOverrideBusy,
    disconnectYoutubeOverride,
    disconnectTwitchOverride,
    disconnectVkvideoOverride,
  };
};

export type UseBotOverridesResult = ReturnType<typeof useBotOverrides>;
