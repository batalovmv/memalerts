import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

import type { ExternalAccount } from '@/types';

import { api } from '@/lib/api';
import { linkExternalAccount, linkTwitchAccount, login } from '@/lib/auth';
import { BoostyLinkModal } from '@/features/settings/ui/BoostyLinkModal';
import { toApiError } from '@/shared/api/toApiError';
import { getApiOriginForRedirect } from '@/shared/auth/login';
import { useAuthQueryErrorToast } from '@/shared/auth/useAuthQueryErrorToast';
import { Button, Card } from '@/shared/ui';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { fetchUser } from '@/store/slices/authSlice';

function normalizeAccounts(input: unknown): ExternalAccount[] {
  const dedupeByProvider = (arr: ExternalAccount[]): ExternalAccount[] => {
    const parseTs = (s: string | undefined): number | null => {
      if (!s) return null;
      const t = Date.parse(s);
      return Number.isFinite(t) ? t : null;
    };
    const byProvider = new Map<string, ExternalAccount>();
    for (const a of arr) {
      const key = String(a?.provider || '').toLowerCase();
      if (!key) continue;
      const prev = byProvider.get(key);
      if (!prev) {
        byProvider.set(key, a);
        continue;
      }
      const prevTs = parseTs(prev.updatedAt);
      const nextTs = parseTs(a.updatedAt);
      // Prefer the most recently updated link (helps avoid UI weirdness if backend returns duplicates).
      if (nextTs !== null && (prevTs === null || nextTs >= prevTs)) {
        byProvider.set(key, a);
      }
    }
    return Array.from(byProvider.values());
  };

  if (Array.isArray(input)) return dedupeByProvider(input as ExternalAccount[]);
  // Backend shape: { accounts: [...] }
  if (input && typeof input === 'object') {
    const obj = input as { accounts?: unknown };
    if (Array.isArray(obj.accounts)) return dedupeByProvider(obj.accounts as ExternalAccount[]);
  }
  return [];
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5" aria-hidden="true">
      <path
        fillRule="evenodd"
        d="M16.704 5.29a1 1 0 0 1 .007 1.414l-7.5 7.6a1 1 0 0 1-1.42.004l-3.5-3.5a1 1 0 1 1 1.414-1.414l2.79 2.79 6.792-6.884a1 1 0 0 1 1.417-.01Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

type ServiceIconProps = { className?: string };

function TwitchIcon({ className }: ServiceIconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className ?? 'w-6 h-6'} aria-hidden="true" fill="currentColor">
      <path d="M4 2h18v12l-6 6h-5l-3 3H6v-3H4V2zm2 2v14h3v3l3-3h5l4-4V4H6zm11 8h-2V6h2v6zm-5 0H10V6h2v6z" />
    </svg>
  );
}

function YouTubeIcon({ className }: ServiceIconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className ?? 'w-6 h-6'} aria-hidden="true" fill="currentColor">
      <path d="M23.5 6.2a3.1 3.1 0 0 0-2.2-2.2C19.4 3.5 12 3.5 12 3.5s-7.4 0-9.3.5A3.1 3.1 0 0 0 .5 6.2 32 32 0 0 0 0 12s0 4.2.5 5.8a3.1 3.1 0 0 0 2.2 2.2c1.9.5 9.3.5 9.3.5s7.4 0 9.3-.5a3.1 3.1 0 0 0 2.2-2.2c.5-1.6.5-5.8.5-5.8s0-4.2-.5-5.8zM9.7 15.5V8.5L16 12l-6.3 3.5z" />
    </svg>
  );
}

function KickIcon({ className }: ServiceIconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className ?? 'w-6 h-6'} aria-hidden="true" fill="currentColor">
      <path d="M5 3h6v6h2V7h6v6h-2v2h2v6h-6v-2h-2v2H5V3zm2 2v14h2v-4h2v-2H9V5H7zm6 6v2h2v2h2V9h-4z" />
    </svg>
  );
}

function TrovoIcon({ className }: ServiceIconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className ?? 'w-6 h-6'} aria-hidden="true" fill="currentColor">
      <path d="M4 6a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V6zm7 3v6l5-3-5-3z" />
    </svg>
  );
}

function VkIcon({ className }: ServiceIconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className ?? 'w-6 h-6'} aria-hidden="true" fill="currentColor">
      <path d="M3.5 7.2c.1-.4.5-.7 1-.7h2.8c.5 0 .9.3 1 .8.7 3 2.6 5.7 4.3 5.7.5 0 .7-.4.7-1.3V8.4c0-1 .3-1.4 1.2-1.4h2.7c.6 0 1 .4 1 .9 0 1.2-1.3 1.5-1.3 3 0 .5.2 1 .8 1.6 1 1 2.2 2.4 2.4 3.3.1.5-.2.9-.8.9h-2.8c-.6 0-1-.2-1.4-.7-.7-.9-1.4-2-2-2-.5 0-.6.4-.6 1.2v1c0 .6-.5 1.1-1.1 1.1C8.9 18.2 4.2 14.3 3.4 8c0-.3 0-.5.1-.8z" />
    </svg>
  );
}

function BoostyIcon({ className }: ServiceIconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className ?? 'w-6 h-6'} aria-hidden="true" fill="currentColor">
      <path d="M12 2c4.4 0 8 3.6 8 8 0 3.2-1.9 6-4.7 7.3V22l-3.3-2-3.3 2v-4.7C5.9 16 4 13.2 4 10c0-4.4 3.6-8 8-8zm-2 6v4h2.2c.9 0 1.5-.6 1.5-1.5S13.1 9 12.2 9H10zm0 6v2h2.4c1.1 0 1.8-.7 1.8-1.7S13.5 12 12.4 12H10z" />
    </svg>
  );
}

export function AccountsSettings() {
  const { t } = useTranslation();
  const { user } = useAppSelector((s) => s.auth);
  const dispatch = useAppDispatch();
  const [unlinkingProvider, setUnlinkingProvider] = useState<string | null>(null);
  const [accountsOverride, setAccountsOverride] = useState<ExternalAccount[] | null>(null);
  const [boostyModalOpen, setBoostyModalOpen] = useState(false);
  const [defaultTwitchBotStatus, setDefaultTwitchBotStatus] = useState<{ enabled: boolean; updatedAt?: string | null } | null>(null);
  const [defaultTwitchBotLoading, setDefaultTwitchBotLoading] = useState(false);
  const [defaultTwitchBotBusy, setDefaultTwitchBotBusy] = useState(false);
  const [defaultYoutubeBotStatus, setDefaultYoutubeBotStatus] = useState<{ enabled: boolean; updatedAt?: string | null } | null>(null);
  const [defaultYoutubeBotLoading, setDefaultYoutubeBotLoading] = useState(false);
  const [defaultYoutubeBotBusy, setDefaultYoutubeBotBusy] = useState(false);
  const [defaultVkvideoBotStatus, setDefaultVkvideoBotStatus] = useState<{ enabled: boolean; updatedAt?: string | null } | null>(null);
  const [defaultVkvideoBotLoading, setDefaultVkvideoBotLoading] = useState(false);
  const [defaultVkvideoBotBusy, setDefaultVkvideoBotBusy] = useState(false);
  const [defaultKickBotStatus, setDefaultKickBotStatus] = useState<{ enabled: boolean; updatedAt?: string | null } | null>(null);
  const [defaultKickBotLoading, setDefaultKickBotLoading] = useState(false);
  const [defaultKickBotBusy, setDefaultKickBotBusy] = useState(false);
  const [defaultTrovoBotStatus, setDefaultTrovoBotStatus] = useState<{ enabled: boolean; updatedAt?: string | null } | null>(null);
  const [defaultTrovoBotLoading, setDefaultTrovoBotLoading] = useState(false);
  const [defaultTrovoBotBusy, setDefaultTrovoBotBusy] = useState(false);
  const refreshedOnMountRef = useRef(false);
  const isMountedRef = useRef(true);

  useAuthQueryErrorToast();

  useEffect(() => {
    // OAuth callback may redirect here with:
    // error=auth_failed&reason=subscription_required&provider=twitch|youtube|vkvideo|trovo|kick
    try {
      const url = new URL(window.location.href);
      const reason = url.searchParams.get('reason');
      const provider = (url.searchParams.get('provider') || '').toLowerCase();
      const isProvider = provider === 'twitch' || provider === 'youtube' || provider === 'vkvideo' || provider === 'trovo' || provider === 'kick';
      if (reason === 'subscription_required' && isProvider) {
        toast.error(
          t('subscription.oauthSubscriptionRequiredBody', {
            defaultValue:
              'Аккаунт привязан, но использовать как bot sender для канала можно только по подписке.',
          })
        );
        url.searchParams.delete('error');
        url.searchParams.delete('reason');
        url.searchParams.delete('provider');
        window.history.replaceState({}, '', url.toString());
      }
    } catch {
      // ignore
    }
  }, [t]);

  // Prefer /auth/accounts (linked login accounts). /me.externalAccounts may include bot-credentials,
  // which should not flip "Connected" state in Accounts UI.
  const accounts = useMemo(
    () => (accountsOverride ? accountsOverride : normalizeAccounts(user?.externalAccounts)),
    [accountsOverride, user?.externalAccounts]
  );
  const linkedProviders = useMemo(() => new Set(accounts.map((a) => a.provider)), [accounts]);

  // After OAuth callback user returns to /settings/accounts. Refresh linked accounts from backend.
  useEffect(() => {
    if (refreshedOnMountRef.current) return;
    refreshedOnMountRef.current = true;

    isMountedRef.current = true;

    // Defensive cooldown: if this tab is repeatedly mounted/unmounted (navigation churn),
    // avoid spamming backend with /auth/accounts + /me on each mount.
    const COOLDOWN_MS = 10_000;
    const storageKey = 'memalerts:accountsSettings:lastRefreshAt';
    let withinCooldown = false;
    try {
      const last = Number(sessionStorage.getItem(storageKey) || '0');
      if (Number.isFinite(last) && last > 0 && Date.now() - last < COOLDOWN_MS) {
        withinCooldown = true;
      } else {
        sessionStorage.setItem(storageKey, String(Date.now()));
      }
    } catch {
      // sessionStorage may be unavailable (privacy mode). Ignore.
    }

    void (async () => {
      try {
        const items = await api.get<unknown>('/auth/accounts', { timeout: 8000 });
        const normalized = normalizeAccounts(items);
        if (isMountedRef.current) setAccountsOverride(normalized);
      } catch {
        // Best-effort: keep existing accounts from /me.
      }

      // Optional refresh of /me (updates redux user, channel data, etc).
      // Keep a cooldown here to avoid spamming backend on navigation churn.
      if (withinCooldown) return;
      try {
        await dispatch(fetchUser()).unwrap();
      } catch {
        // best-effort
      }
    })();

    return () => {
      isMountedRef.current = false;
    };
  }, [dispatch]);

  useEffect(() => {
    if (user?.role !== 'admin') return;
    let cancelled = false;
    const parse = (res: unknown): { enabled: boolean; updatedAt: string | null } => {
      const enabled = Boolean((res as { enabled?: unknown } | null)?.enabled);
      const updatedAtRaw = (res as { updatedAt?: unknown } | null)?.updatedAt;
      const updatedAt = typeof updatedAtRaw === 'string' ? updatedAtRaw : null;
      return { enabled, updatedAt };
    };

    setDefaultTwitchBotLoading(true);
    setDefaultYoutubeBotLoading(true);
    setDefaultVkvideoBotLoading(true);
    setDefaultKickBotLoading(true);
    setDefaultTrovoBotLoading(true);

    void (async () => {
      const [tw, yt, vk, kick, trovo] = await Promise.allSettled([
        api.get<unknown>('/owner/bots/twitch/default/status', { timeout: 8000 }),
        api.get<unknown>('/owner/bots/youtube/default/status', { timeout: 8000 }),
        api.get<unknown>('/owner/bots/vkvideo/default/status', { timeout: 8000 }),
        api.get<unknown>('/owner/bots/kick/default/status', { timeout: 8000 }),
        api.get<unknown>('/owner/bots/trovo/default/status', { timeout: 8000 }),
      ]);

      if (cancelled) return;

      if (tw.status === 'fulfilled') setDefaultTwitchBotStatus(parse(tw.value));
      else setDefaultTwitchBotStatus(null);

      if (yt.status === 'fulfilled') setDefaultYoutubeBotStatus(parse(yt.value));
      else setDefaultYoutubeBotStatus(null);

      if (vk.status === 'fulfilled') setDefaultVkvideoBotStatus(parse(vk.value));
      else setDefaultVkvideoBotStatus(null);

      if (kick.status === 'fulfilled') setDefaultKickBotStatus(parse(kick.value));
      else setDefaultKickBotStatus(null);

      if (trovo.status === 'fulfilled') setDefaultTrovoBotStatus(parse(trovo.value));
      else setDefaultTrovoBotStatus(null);

      setDefaultTwitchBotLoading(false);
      setDefaultYoutubeBotLoading(false);
      setDefaultVkvideoBotLoading(false);
      setDefaultKickBotLoading(false);
      setDefaultTrovoBotLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.role]);

  const redirectToDefaultYoutubeBotLink = useCallback(() => {
    const apiOrigin = getApiOriginForRedirect();
    const url = new URL(`${apiOrigin}/owner/bots/youtube/default/link`);
    // Admin flow lives in Accounts; keep it on the allowlisted path.
    url.searchParams.set('redirect_to', '/settings/accounts');
    url.searchParams.set('origin', window.location.origin);
    window.location.href = url.toString();
  }, []);

  const redirectToDefaultTwitchBotLink = useCallback(() => {
    const apiOrigin = getApiOriginForRedirect();
    const url = new URL(`${apiOrigin}/owner/bots/twitch/default/link`);
    url.searchParams.set('redirect_to', '/settings/accounts');
    url.searchParams.set('origin', window.location.origin);
    window.location.href = url.toString();
  }, []);

  const redirectToDefaultVkvideoBotLink = useCallback(() => {
    const apiOrigin = getApiOriginForRedirect();
    const url = new URL(`${apiOrigin}/owner/bots/vkvideo/default/link`);
    url.searchParams.set('redirect_to', '/settings/accounts');
    url.searchParams.set('origin', window.location.origin);
    window.location.href = url.toString();
  }, []);

  const redirectToDefaultKickBotLink = useCallback(() => {
    const apiOrigin = getApiOriginForRedirect();
    const url = new URL(`${apiOrigin}/owner/bots/kick/default/link`);
    url.searchParams.set('redirect_to', '/settings/accounts');
    url.searchParams.set('origin', window.location.origin);
    window.location.href = url.toString();
  }, []);

  const redirectToDefaultTrovoBotLink = useCallback(() => {
    const apiOrigin = getApiOriginForRedirect();
    const url = new URL(`${apiOrigin}/owner/bots/trovo/default/link`);
    url.searchParams.set('redirect_to', '/settings/accounts');
    url.searchParams.set('origin', window.location.origin);
    window.location.href = url.toString();
  }, []);

  const disconnectDefaultTwitchBot = useCallback(async () => {
    if (defaultTwitchBotBusy) return;
    const confirmed = window.confirm(
      t('settings.defaultTwitchBotDisconnectConfirm', { defaultValue: 'Отключить дефолтного Twitch-бота?' })
    );
    if (!confirmed) return;

    try {
      setDefaultTwitchBotBusy(true);
      await api.delete('/owner/bots/twitch/default');
      const res = await api.get<unknown>('/owner/bots/twitch/default/status', { timeout: 8000 });
      const enabled = Boolean((res as { enabled?: unknown } | null)?.enabled);
      const updatedAtRaw = (res as { updatedAt?: unknown } | null)?.updatedAt;
      const updatedAt = typeof updatedAtRaw === 'string' ? updatedAtRaw : null;
      setDefaultTwitchBotStatus({ enabled, updatedAt });
      toast.success(t('admin.saved', { defaultValue: 'Saved.' }));
    } catch (e) {
      const err = toApiError(e, t('admin.failedToSave', { defaultValue: 'Failed to save.' }));
      toast.error(err.message);
    } finally {
      setDefaultTwitchBotBusy(false);
    }
  }, [defaultTwitchBotBusy, t]);

  const disconnectDefaultYoutubeBot = useCallback(async () => {
    if (defaultYoutubeBotBusy) return;
    const confirmed = window.confirm(
      t('settings.defaultYoutubeBotDisconnectConfirm', { defaultValue: 'Отключить дефолтного YouTube-бота?' })
    );
    if (!confirmed) return;

    try {
      setDefaultYoutubeBotBusy(true);
      await api.delete('/owner/bots/youtube/default');
      const res = await api.get<unknown>('/owner/bots/youtube/default/status', { timeout: 8000 });
      const enabled = Boolean((res as { enabled?: unknown } | null)?.enabled);
      const updatedAtRaw = (res as { updatedAt?: unknown } | null)?.updatedAt;
      const updatedAt = typeof updatedAtRaw === 'string' ? updatedAtRaw : null;
      setDefaultYoutubeBotStatus({ enabled, updatedAt });
      toast.success(t('admin.saved', { defaultValue: 'Saved.' }));
    } catch (e) {
      const err = toApiError(e, t('admin.failedToSave', { defaultValue: 'Failed to save.' }));
      toast.error(err.message);
    } finally {
      setDefaultYoutubeBotBusy(false);
    }
  }, [defaultYoutubeBotBusy, t]);

  const disconnectDefaultVkvideoBot = useCallback(async () => {
    if (defaultVkvideoBotBusy) return;
    const confirmed = window.confirm(
      t('settings.defaultVkvideoBotDisconnectConfirm', { defaultValue: 'Отключить дефолтного VKVideo-бота?' })
    );
    if (!confirmed) return;

    try {
      setDefaultVkvideoBotBusy(true);
      await api.delete('/owner/bots/vkvideo/default');
      const res = await api.get<unknown>('/owner/bots/vkvideo/default/status', { timeout: 8000 });
      const enabled = Boolean((res as { enabled?: unknown } | null)?.enabled);
      const updatedAtRaw = (res as { updatedAt?: unknown } | null)?.updatedAt;
      const updatedAt = typeof updatedAtRaw === 'string' ? updatedAtRaw : null;
      setDefaultVkvideoBotStatus({ enabled, updatedAt });
      toast.success(t('admin.saved', { defaultValue: 'Saved.' }));
    } catch (e) {
      const err = toApiError(e, t('admin.failedToSave', { defaultValue: 'Failed to save.' }));
      toast.error(err.message);
    } finally {
      setDefaultVkvideoBotBusy(false);
    }
  }, [defaultVkvideoBotBusy, t]);

  const disconnectDefaultKickBot = useCallback(async () => {
    if (defaultKickBotBusy) return;
    const confirmed = window.confirm(t('settings.defaultKickBotDisconnectConfirm', { defaultValue: 'Отключить дефолтного Kick-бота?' }));
    if (!confirmed) return;

    try {
      setDefaultKickBotBusy(true);
      await api.delete('/owner/bots/kick/default');
      const res = await api.get<unknown>('/owner/bots/kick/default/status', { timeout: 8000 });
      const enabled = Boolean((res as { enabled?: unknown } | null)?.enabled);
      const updatedAtRaw = (res as { updatedAt?: unknown } | null)?.updatedAt;
      const updatedAt = typeof updatedAtRaw === 'string' ? updatedAtRaw : null;
      setDefaultKickBotStatus({ enabled, updatedAt });
      toast.success(t('admin.saved', { defaultValue: 'Saved.' }));
    } catch (e) {
      const err = toApiError(e, t('admin.failedToSave', { defaultValue: 'Failed to save.' }));
      toast.error(err.message);
    } finally {
      setDefaultKickBotBusy(false);
    }
  }, [defaultKickBotBusy, t]);

  const disconnectDefaultTrovoBot = useCallback(async () => {
    if (defaultTrovoBotBusy) return;
    const confirmed = window.confirm(t('settings.defaultTrovoBotDisconnectConfirm', { defaultValue: 'Отключить дефолтного Trovo-бота?' }));
    if (!confirmed) return;

    try {
      setDefaultTrovoBotBusy(true);
      await api.delete('/owner/bots/trovo/default');
      const res = await api.get<unknown>('/owner/bots/trovo/default/status', { timeout: 8000 });
      const enabled = Boolean((res as { enabled?: unknown } | null)?.enabled);
      const updatedAtRaw = (res as { updatedAt?: unknown } | null)?.updatedAt;
      const updatedAt = typeof updatedAtRaw === 'string' ? updatedAtRaw : null;
      setDefaultTrovoBotStatus({ enabled, updatedAt });
      toast.success(t('admin.saved', { defaultValue: 'Saved.' }));
    } catch (e) {
      const err = toApiError(e, t('admin.failedToSave', { defaultValue: 'Failed to save.' }));
      toast.error(err.message);
    } finally {
      setDefaultTrovoBotBusy(false);
    }
  }, [defaultTrovoBotBusy, t]);

  const ensureSessionOrLogin = useCallback(async () => {
    try {
      // Fast check that cookie/session is present on the API origin.
      await api.get('/me');
      return true;
    } catch (e) {
      const err = toApiError(e, 'Authentication required');
      if (err.statusCode === 401) {
        toast.error(t('auth.authRequired', { defaultValue: 'Please sign in to continue.' }));
        login('/settings/accounts');
        return false;
      }
      // Non-auth errors: surface and don't redirect away.
      toast.error(err.message);
      return false;
    }
  }, [t]);

  const refreshLinkedAccounts = useCallback(async () => {
    try {
      const items = await api.get<unknown>('/auth/accounts', { timeout: 8000 });
      const normalized = normalizeAccounts(items);
      if (isMountedRef.current) setAccountsOverride(normalized);
    } catch {
      // best-effort
    }
    try {
      await dispatch(fetchUser()).unwrap();
    } catch {
      // best-effort
    }
  }, [dispatch]);

  const linkTwitch = useCallback(() => {
    void (async () => {
      const ok = await ensureSessionOrLogin();
      if (!ok) return;
      linkTwitchAccount('/settings/accounts');
    })();
  }, [ensureSessionOrLogin]);

  const linkBoosty = useCallback(() => {
    void (async () => {
      const ok = await ensureSessionOrLogin();
      if (!ok) return;
      setBoostyModalOpen(true);
    })();
  }, [ensureSessionOrLogin]);

  const linkProvider = useCallback((provider: string) => {
    // Keep dedicated Twitch link (backward compat), and use generic for others.
    void (async () => {
      const ok = await ensureSessionOrLogin();
      if (!ok) return;

      if (provider === 'twitch') {
        linkTwitchAccount('/settings/accounts');
        return;
      }
      linkExternalAccount(provider, '/settings/accounts');
    })();
  }, [ensureSessionOrLogin]);

  const services = useMemo(
    () =>
      [
        {
          provider: 'twitch' as const,
          title: t('settings.accountsServiceTwitch', { defaultValue: 'Twitch' }),
          description: t('settings.accountsServiceTwitchHint', {
            defaultValue: 'Used to sign in and enable Twitch-only features.',
          }),
          icon: TwitchIcon,
          iconClassName: 'text-[#9146FF]',
          supportsLink: true,
          isAvailable: true,
          onLink: linkTwitch,
        },
        {
          provider: 'youtube',
          title: t('settings.accountsServiceYouTube', { defaultValue: 'YouTube' }),
          description: t('settings.accountsServiceYouTubeHint', {
            defaultValue: 'Used for YouTube integrations.',
          }),
          icon: YouTubeIcon,
          iconClassName: 'text-[#FF0000]',
          supportsLink: true,
          isAvailable: true,
          onLink: () => linkProvider('youtube'),
        },
        {
          provider: 'vkvideo',
          title: t('settings.accountsServiceVkvideo', { defaultValue: 'VK Video Live' }),
          description: t('settings.accountsServiceVkvideoHint', {
            defaultValue: 'Used for VK Video Live integrations.',
          }),
          icon: VkIcon,
          iconClassName: 'text-[#0077FF]',
          supportsLink: true,
          onLink: () => linkProvider('vkvideo'),
          isAvailable: true,
        },
        {
          provider: 'boosty',
          title: t('settings.accountsServiceBoosty', { defaultValue: 'Boosty' }),
          description: t('settings.accountsServiceBoostyHint', {
            defaultValue: 'Used for Boosty integrations.',
          }),
          icon: BoostyIcon,
          iconClassName: 'text-[#F15A24]',
          supportsLink: true,
          isAvailable: true,
          onLink: linkBoosty,
        },
        {
          provider: 'kick',
          title: t('settings.accountsServiceKick', { defaultValue: 'Kick' }),
          description: t('settings.accountsServiceKickHint', {
            defaultValue: 'Used for Kick integrations.',
          }),
          icon: KickIcon,
          iconClassName: 'text-[#53FC18]',
          supportsLink: true,
          isAvailable: true,
          onLink: () => linkProvider('kick'),
        },
        {
          provider: 'trovo',
          title: t('settings.accountsServiceTrovo', { defaultValue: 'Trovo' }),
          description: t('settings.accountsServiceTrovoHint', {
            defaultValue: 'Used for Trovo integrations.',
          }),
          icon: TrovoIcon,
          iconClassName: 'text-[#1BD96A]',
          supportsLink: true,
          isAvailable: true,
          onLink: () => linkProvider('trovo'),
        },
      ] as const,
    [linkBoosty, linkProvider, linkTwitch, t]
  );

  const unlinkAccount = useCallback(
    async (account: ExternalAccount) => {
      if (!account?.id) return;

      const providerLabel = String(account.provider || '').toUpperCase() || 'ACCOUNT';
      const confirmed = window.confirm(
        t('settings.accountsUnlinkConfirm', {
          defaultValue: `Disconnect ${providerLabel}?`,
          provider: providerLabel,
        })
      );
      if (!confirmed) return;

      try {
        setUnlinkingProvider(account.provider);
        await api.delete(`/auth/accounts/${encodeURIComponent(account.id)}`);
        await dispatch(fetchUser()).unwrap();
        setAccountsOverride((prev) => (Array.isArray(prev) ? prev.filter((a) => a?.id !== account.id) : prev));
        toast.success(
          t('settings.accountsUnlinked', {
            defaultValue: 'Disconnected.',
          })
        );
      } catch (e) {
        const err = toApiError(e, 'Failed to disconnect account');

        // Backend may block unlinking accounts that are used as bot credentials.
        // In this case it returns 409 with details: { kind, provider, unlinkEndpoint }.
        if (err.statusCode === 409 && err.details && typeof err.details === 'object') {
          const details = err.details as Record<string, unknown>;
          const unlinkEndpointRaw = typeof details.unlinkEndpoint === 'string' ? details.unlinkEndpoint : null;
          const kind = typeof details.kind === 'string' ? details.kind : null;

          const parseEndpointPath = (val: string): string | null => {
            // Expected: "DELETE /owner/bots/twitch/default"
            const parts = val.trim().split(/\s+/);
            const path = parts.length >= 2 ? parts[1] : '';
            return path.startsWith('/') ? path : null;
          };

          const unlinkPath = unlinkEndpointRaw ? parseEndpointPath(unlinkEndpointRaw) : null;
          if (unlinkPath) {
            const confirmedBot = window.confirm(
              t('settings.accountsBotCredentialUnlinkConfirm', {
                defaultValue:
                  kind === 'global_bot_credential'
                    ? 'Этот аккаунт используется как дефолтный бот. Отключить бота и затем отвязать аккаунт?'
                    : 'Этот аккаунт используется как бот канала. Отключить бота и затем отвязать аккаунт?',
              })
            );
            if (!confirmedBot) return;

            try {
              await api.delete(unlinkPath);
            } catch (e2) {
              const err2 = toApiError(e2, 'Failed to disconnect bot');
              toast.error(err2.message);
              return;
            }

            try {
              await api.delete(`/auth/accounts/${encodeURIComponent(account.id)}`);
            } catch (e3) {
              const err3 = toApiError(e3, 'Failed to disconnect account');
              toast.error(err3.message);
              return;
            }

            try {
              await dispatch(fetchUser()).unwrap();
            } catch {
              // best-effort
            }
            setAccountsOverride((prev) => (Array.isArray(prev) ? prev.filter((a) => a?.id !== account.id) : prev));
            toast.success(
              t('settings.accountsUnlinked', {
                defaultValue: 'Disconnected.',
              })
            );
            return;
          }
        }

        toast.error(err.message);
      } finally {
        setUnlinkingProvider(null);
      }
    },
    [dispatch, t]
  );

  return (
    <div className="space-y-4">
      <BoostyLinkModal
        isOpen={boostyModalOpen}
        onClose={() => setBoostyModalOpen(false)}
        onLinked={async () => {
          await refreshLinkedAccounts();
        }}
      />
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h2 className="text-2xl font-bold dark:text-white">{t('settings.accountsTitle', { defaultValue: 'Linked accounts' })}</h2>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
            {t('settings.accountsHint', {
              defaultValue: 'Connect services to sign in and enable integrations.',
            })}
          </p>
        </div>
      </div>

      {user?.role === 'admin' && (
        <Card className="p-5 mb-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="font-semibold text-gray-900 dark:text-white">
                {t('settings.defaultTwitchBotTitle', { defaultValue: 'Дефолтный Twitch бот' })}
              </div>
              <div className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                {defaultTwitchBotLoading ? (
                  t('common.loading', { defaultValue: 'Loading…' })
                ) : defaultTwitchBotStatus?.enabled ? (
                  <>
                    {t('settings.defaultTwitchBotConnected', { defaultValue: 'Подключён' })}
                    {defaultTwitchBotStatus.updatedAt ? (
                      <span className="ml-2 opacity-80">
                        {t('admin.updatedAt', { defaultValue: 'Updated' })}:{' '}
                        {new Date(defaultTwitchBotStatus.updatedAt).toLocaleString()}
                      </span>
                    ) : null}
                  </>
                ) : (
                  t('settings.defaultTwitchBotNotConnected', { defaultValue: 'Дефолтный Twitch бот не подключён' })
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {defaultTwitchBotStatus?.enabled ? (
                <>
                  <Button
                    variant="secondary"
                    onClick={() => redirectToDefaultTwitchBotLink()}
                    disabled={defaultTwitchBotBusy}
                  >
                    {t('settings.defaultTwitchBotRelink', { defaultValue: 'Перепривязать' })}
                  </Button>
                  <Button variant="secondary" onClick={() => void disconnectDefaultTwitchBot()} disabled={defaultTwitchBotBusy}>
                    {t('settings.defaultTwitchBotDisconnect', { defaultValue: 'Отключить' })}
                  </Button>
                </>
              ) : (
                <Button variant="primary" onClick={() => redirectToDefaultTwitchBotLink()} disabled={defaultTwitchBotBusy}>
                  {t('settings.defaultTwitchBotConnect', { defaultValue: 'Подключить' })}
                </Button>
              )}
            </div>
          </div>
        </Card>
      )}

      {user?.role === 'admin' && (
        <Card className="p-5 mb-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="font-semibold text-gray-900 dark:text-white">
                {t('settings.defaultYoutubeBotTitle', { defaultValue: 'Дефолтный YouTube бот' })}
              </div>
              <div className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                {defaultYoutubeBotLoading ? (
                  t('common.loading', { defaultValue: 'Loading…' })
                ) : defaultYoutubeBotStatus?.enabled ? (
                  <>
                    {t('settings.defaultYoutubeBotConnected', { defaultValue: 'Подключён' })}
                    {defaultYoutubeBotStatus.updatedAt ? (
                      <span className="ml-2 opacity-80">
                        {t('admin.updatedAt', { defaultValue: 'Updated' })}:{' '}
                        {new Date(defaultYoutubeBotStatus.updatedAt).toLocaleString()}
                      </span>
                    ) : null}
                  </>
                ) : (
                  t('settings.defaultYoutubeBotNotConnected', { defaultValue: 'Дефолтный YouTube бот не подключён' })
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {defaultYoutubeBotStatus?.enabled ? (
                <>
                  <Button
                    variant="secondary"
                    onClick={() => redirectToDefaultYoutubeBotLink()}
                    disabled={defaultYoutubeBotBusy}
                  >
                    {t('settings.defaultYoutubeBotRelink', { defaultValue: 'Перепривязать' })}
                  </Button>
                  <Button variant="secondary" onClick={() => void disconnectDefaultYoutubeBot()} disabled={defaultYoutubeBotBusy}>
                    {t('settings.defaultYoutubeBotDisconnect', { defaultValue: 'Отключить' })}
                  </Button>
                </>
              ) : (
                <Button
                  variant="primary"
                  onClick={() => redirectToDefaultYoutubeBotLink()}
                  disabled={defaultYoutubeBotBusy}
                >
                  {t('settings.defaultYoutubeBotConnect', { defaultValue: 'Подключить' })}
                </Button>
              )}
            </div>
          </div>
        </Card>
      )}

      {user?.role === 'admin' && (
        <Card className="p-5 mb-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="font-semibold text-gray-900 dark:text-white">
                {t('settings.defaultVkvideoBotTitle', { defaultValue: 'Дефолтный VKVideo бот' })}
              </div>
              <div className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                {defaultVkvideoBotLoading ? (
                  t('common.loading', { defaultValue: 'Loading…' })
                ) : defaultVkvideoBotStatus?.enabled ? (
                  <>
                    {t('settings.defaultVkvideoBotConnected', { defaultValue: 'Подключён' })}
                    {defaultVkvideoBotStatus.updatedAt ? (
                      <span className="ml-2 opacity-80">
                        {t('admin.updatedAt', { defaultValue: 'Updated' })}:{' '}
                        {new Date(defaultVkvideoBotStatus.updatedAt).toLocaleString()}
                      </span>
                    ) : null}
                  </>
                ) : (
                  t('settings.defaultVkvideoBotNotConnected', { defaultValue: 'Дефолтный VKVideo бот не подключён' })
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {defaultVkvideoBotStatus?.enabled ? (
                <>
                  <Button variant="secondary" onClick={() => redirectToDefaultVkvideoBotLink()} disabled={defaultVkvideoBotBusy}>
                    {t('settings.defaultVkvideoBotRelink', { defaultValue: 'Перепривязать' })}
                  </Button>
                  <Button variant="secondary" onClick={() => void disconnectDefaultVkvideoBot()} disabled={defaultVkvideoBotBusy}>
                    {t('settings.defaultVkvideoBotDisconnect', { defaultValue: 'Отключить' })}
                  </Button>
                </>
              ) : (
                <Button variant="primary" onClick={() => redirectToDefaultVkvideoBotLink()} disabled={defaultVkvideoBotBusy}>
                  {t('settings.defaultVkvideoBotConnect', { defaultValue: 'Подключить' })}
                </Button>
              )}
            </div>
          </div>
        </Card>
      )}

      {user?.role === 'admin' && (
        <Card className="p-5 mb-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="font-semibold text-gray-900 dark:text-white">
                {t('settings.defaultKickBotTitle', { defaultValue: 'Дефолтный Kick бот' })}
              </div>
              <div className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                {defaultKickBotLoading ? (
                  t('common.loading', { defaultValue: 'Loading…' })
                ) : defaultKickBotStatus?.enabled ? (
                  <>
                    {t('settings.defaultKickBotConnected', { defaultValue: 'Подключён' })}
                    {defaultKickBotStatus.updatedAt ? (
                      <span className="ml-2 opacity-80">
                        {t('admin.updatedAt', { defaultValue: 'Updated' })}:{' '}
                        {new Date(defaultKickBotStatus.updatedAt).toLocaleString()}
                      </span>
                    ) : null}
                  </>
                ) : (
                  t('settings.defaultKickBotNotConnected', { defaultValue: 'Дефолтный Kick бот не подключён' })
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {defaultKickBotStatus?.enabled ? (
                <>
                  <Button variant="secondary" onClick={() => redirectToDefaultKickBotLink()} disabled={defaultKickBotBusy}>
                    {t('settings.defaultKickBotRelink', { defaultValue: 'Перепривязать' })}
                  </Button>
                  <Button variant="secondary" onClick={() => void disconnectDefaultKickBot()} disabled={defaultKickBotBusy}>
                    {t('settings.defaultKickBotDisconnect', { defaultValue: 'Отключить' })}
                  </Button>
                </>
              ) : (
                <Button variant="primary" onClick={() => redirectToDefaultKickBotLink()} disabled={defaultKickBotBusy}>
                  {t('settings.defaultKickBotConnect', { defaultValue: 'Подключить' })}
                </Button>
              )}
            </div>
          </div>
        </Card>
      )}

      {user?.role === 'admin' && (
        <Card className="p-5 mb-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="font-semibold text-gray-900 dark:text-white">
                {t('settings.defaultTrovoBotTitle', { defaultValue: 'Дефолтный Trovo бот' })}
              </div>
              <div className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                {defaultTrovoBotLoading ? (
                  t('common.loading', { defaultValue: 'Loading…' })
                ) : defaultTrovoBotStatus?.enabled ? (
                  <>
                    {t('settings.defaultTrovoBotConnected', { defaultValue: 'Подключён' })}
                    {defaultTrovoBotStatus.updatedAt ? (
                      <span className="ml-2 opacity-80">
                        {t('admin.updatedAt', { defaultValue: 'Updated' })}:{' '}
                        {new Date(defaultTrovoBotStatus.updatedAt).toLocaleString()}
                      </span>
                    ) : null}
                  </>
                ) : (
                  t('settings.defaultTrovoBotNotConnected', { defaultValue: 'Дефолтный Trovo бот не подключён' })
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {defaultTrovoBotStatus?.enabled ? (
                <>
                  <Button variant="secondary" onClick={() => redirectToDefaultTrovoBotLink()} disabled={defaultTrovoBotBusy}>
                    {t('settings.defaultTrovoBotRelink', { defaultValue: 'Перепривязать' })}
                  </Button>
                  <Button variant="secondary" onClick={() => void disconnectDefaultTrovoBot()} disabled={defaultTrovoBotBusy}>
                    {t('settings.defaultTrovoBotDisconnect', { defaultValue: 'Отключить' })}
                  </Button>
                </>
              ) : (
                <Button variant="primary" onClick={() => redirectToDefaultTrovoBotLink()} disabled={defaultTrovoBotBusy}>
                  {t('settings.defaultTrovoBotConnect', { defaultValue: 'Подключить' })}
                </Button>
              )}
            </div>
          </div>
        </Card>
      )}

      <div className="space-y-3">
        {services.map((service) => {
          const isLinked = linkedProviders.has(service.provider);
          const linkedAccount = accounts.find((a) => a.provider === service.provider) as ExternalAccount | undefined;
          const Icon = service.icon;
          const isBoosty = service.provider === 'boosty';
          return (
            <Card key={service.provider} className="p-5 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-3 min-w-0">
                  <span
                    className={[
                      'grid place-items-center shrink-0 w-9 h-9 rounded-lg',
                      'bg-black/5 dark:bg-white/10',
                      service.iconClassName ?? 'text-gray-700 dark:text-gray-200',
                    ].join(' ')}
                    aria-hidden="true"
                  >
                    <Icon className="w-5 h-5" />
                  </span>
                  <div className="min-w-0">
                    <div className="font-semibold text-gray-900 dark:text-white truncate">{service.title}</div>
                    <div className="text-sm text-gray-600 dark:text-gray-400 mt-1 truncate">
                      {isLinked && linkedAccount?.login ? `@${linkedAccount.login}` : service.description}
                    </div>
                    {isLinked && isBoosty ? (
                      <div className="mt-1 text-xs text-gray-600 dark:text-gray-400 space-y-1">
                        {linkedAccount?.login ? (
                          <div>
                            {t('settings.boostyAccountLabel', { defaultValue: 'Аккаунт' })}:{' '}
                            <span className="font-mono">@{linkedAccount.login}</span>
                          </div>
                        ) : null}
                        {linkedAccount?.profileUrl ? (
                          <div>
                            <a
                              href={linkedAccount.profileUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="underline hover:no-underline"
                            >
                              {t('settings.boostyOpenProfile', { defaultValue: 'Открыть профиль' })}
                            </a>
                          </div>
                        ) : null}
                        {linkedAccount?.updatedAt ? (
                          <div>
                            {t('settings.boostyLinkedUpdatedAt', { defaultValue: 'Последнее обновление привязки' })}:{' '}
                            {new Date(linkedAccount.updatedAt).toLocaleString()}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-end gap-2 shrink-0">
                {isLinked ? (
                  <>
                    <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400 text-sm font-semibold whitespace-nowrap">
                      <CheckIcon />
                      {t('settings.accountsLinked', { defaultValue: 'Connected' })}
                    </span>
                    {isBoosty ? (
                      <Button variant="secondary" onClick={service.onLink} disabled={unlinkingProvider === service.provider}>
                        {t('settings.accountsRelinkAction', { defaultValue: 'Переподключить' })}
                      </Button>
                    ) : null}
                    <Button
                      variant="secondary"
                      onClick={() => linkedAccount && void unlinkAccount(linkedAccount)}
                      disabled={!linkedAccount || unlinkingProvider === service.provider}
                    >
                      {unlinkingProvider === service.provider
                        ? t('common.loading', { defaultValue: 'Loading…' })
                        : t('settings.accountsUnlinkAction', { defaultValue: 'Disconnect' })}
                    </Button>
                  </>
                ) : (
                  <Button variant="primary" onClick={service.onLink} disabled={service.isAvailable === false}>
                    {service.isAvailable === false
                      ? t('common.notAvailable', { defaultValue: 'Not available' })
                      : t('settings.accountsLinkAction', { defaultValue: 'Connect' })}
                  </Button>
                )}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}


