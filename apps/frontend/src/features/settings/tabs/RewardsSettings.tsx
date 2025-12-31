import { useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

import SecretCopyField from '@/components/SecretCopyField';
import { useChannelColors } from '@/contexts/ChannelColorsContext';
import { SettingsSection } from '@/features/settings/ui/SettingsSection';
import { toApiError } from '@/shared/api/toApiError';
import { getApiOriginForRedirect, login } from '@/shared/auth/login';
import { ensureMinDuration } from '@/shared/lib/ensureMinDuration';
import { Button, HelpTooltip, Input } from '@/shared/ui';
import { SavedOverlay, SavingOverlay } from '@/shared/ui/StatusOverlays';
import { useAppSelector } from '@/store/hooks';

function toRecord(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== 'object') return null;
  if (Array.isArray(v)) return null;
  return v as Record<string, unknown>;
}

function getBoolean(obj: unknown, key: string): boolean | undefined {
  const r = toRecord(obj);
  if (!r) return undefined;
  const v = r[key];
  return typeof v === 'boolean' ? v : undefined;
}

type BoostyTierCoinsRow = { tierKey: string; coins: string };
type BoostyTierCoinsRowErrors = Record<number, { tierKey?: string; coins?: string }>;
type BoostyTierCoinsErrorState = { table?: string | null; rows: BoostyTierCoinsRowErrors };

type BoostyAccessStatus = 'need_discord_link' | 'need_join_guild' | 'not_subscribed' | 'subscribed';
type BoostyAccessResponse = {
  status: BoostyAccessStatus;
  requiredGuild: {
    guildId: string;
    autoJoin: boolean;
    name: string | null;
    inviteUrl: string | null;
  };
  matchedTier: string | null;
  matchedRoleId: string | null;
};

function normalizeBoostyAccess(raw: unknown): BoostyAccessResponse | null {
  const r = toRecord(raw);
  if (!r) return null;

  const statusRaw = r.status;
  const status: BoostyAccessStatus | null =
    statusRaw === 'need_discord_link' || statusRaw === 'need_join_guild' || statusRaw === 'not_subscribed' || statusRaw === 'subscribed'
      ? statusRaw
      : null;
  if (!status) return null;

  const rg = toRecord(r.requiredGuild);
  if (!rg) return null;
  // Back-compat: backend may use `id` instead of `guildId`.
  const guildId = typeof rg.guildId === 'string' ? rg.guildId : typeof rg.id === 'string' ? rg.id : null;
  const autoJoin = typeof rg.autoJoin === 'boolean' ? rg.autoJoin : null;
  if (!guildId || autoJoin === null) return null;

  const asNullableString = (v: unknown): string | null => (typeof v === 'string' ? v : v === null ? null : null);

  // Back-compat: matched tier/role may be nested or top-level depending on backend version.
  const matchedTier =
    typeof r.matchedTier === 'string' ? r.matchedTier : typeof rg.matchedTier === 'string' ? rg.matchedTier : null;
  const matchedRoleId =
    typeof r.matchedRoleId === 'string' ? r.matchedRoleId : typeof rg.matchedRoleId === 'string' ? rg.matchedRoleId : null;

  return {
    status,
    requiredGuild: {
      guildId,
      autoJoin,
      name: asNullableString(rg.name),
      inviteUrl: asNullableString(rg.inviteUrl),
    },
    matchedTier,
    matchedRoleId,
  };
}

function parseIntSafe(v: string): number | null {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

// Rewards Settings Component
export function RewardsSettings() {
  const { t } = useTranslation();
  const { user } = useAppSelector((state) => state.auth);
  const { getChannelData, getCachedChannelData } = useChannelColors();
  // Treat undefined as "unknown" (do not block). Block only when backend explicitly says null.
  const twitchLinked = user?.channel?.twitchChannelId !== null;
  const [twitchRewardEligible, setTwitchRewardEligible] = useState<boolean | null>(null);
  const [eligibilityLoading, setEligibilityLoading] = useState(false);
  const [lastErrorRequestId, setLastErrorRequestId] = useState<string | null>(null);
  const [rewardSettings, setRewardSettings] = useState({
    rewardIdForCoins: '',
    rewardEnabled: false,
    rewardTitle: '',
    rewardCost: '',
    rewardCoins: '',
    rewardOnlyWhenLive: false,
    submissionRewardCoinsUpload: '0',
    submissionRewardCoinsPool: '0',
    submissionRewardOnlyWhenLive: false,
  });
  const [boostySettings, setBoostySettings] = useState<{
    boostyBlogName: string;
    boostyCoinsPerSub: string;
    boostyTierCoins: BoostyTierCoinsRow[];
  }>({
    boostyBlogName: '',
    boostyCoinsPerSub: '0',
    boostyTierCoins: [],
  });
  const [boostyTierErrors, setBoostyTierErrors] = useState<BoostyTierCoinsErrorState>({ table: null, rows: {} });
  const [savingBoosty, setSavingBoosty] = useState(false);
  const [boostySavedPulse, setBoostySavedPulse] = useState(false);
  const [savingTwitchReward, setSavingTwitchReward] = useState(false);
  const [savingApprovedMemeReward, setSavingApprovedMemeReward] = useState(false);
  const [twitchSavedPulse, setTwitchSavedPulse] = useState(false);
  const [approvedSavedPulse, setApprovedSavedPulse] = useState(false);
  const [boostyAccess, setBoostyAccess] = useState<BoostyAccessResponse | null>(null);
  const [boostyAccessLoading, setBoostyAccessLoading] = useState(false);
  const [boostyAccessError, setBoostyAccessError] = useState<string | null>(null);
  const boostyAccessLoadingRef = useRef(false);
  const lastApprovedNonZeroRef = useRef<number>(100);
  const lastApprovedNonZeroPoolRef = useRef<number>(100);
  const saveTwitchTimerRef = useRef<number | null>(null);
  const saveApprovedTimerRef = useRef<number | null>(null);
  const saveBoostyTimerRef = useRef<number | null>(null);
  const lastSavedTwitchRef = useRef<string | null>(null);
  const lastSavedApprovedRef = useRef<string | null>(null);
  const lastSavedBoostyRef = useRef<string | null>(null);
  const settingsLoadedRef = useRef<string | null>(null);

  const effectiveChannelId = user?.channelId || user?.channel?.id || null;

  const refreshBoostyAccess = useCallback(async () => {
    if (!effectiveChannelId) return;
    if (boostyAccessLoadingRef.current) return;
    boostyAccessLoadingRef.current = true;
    setBoostyAccessError(null);
    setBoostyAccessLoading(true);
    try {
      const { api } = await import('@/lib/api');
      const raw = await api.get<unknown>(`/channels/${encodeURIComponent(effectiveChannelId)}/boosty-access`, { timeout: 10_000 });
      const parsed = normalizeBoostyAccess(raw);
      if (!parsed) {
        throw new Error('Invalid boosty-access response');
      }
      setBoostyAccess(parsed);
    } catch (e) {
      const err = toApiError(e, t('admin.failedToLoad', { defaultValue: 'Failed to load.' }));
      if (err.statusCode === 401) {
        toast.error(t('auth.authRequired', { defaultValue: 'Please sign in to continue.' }));
        login('/settings?tab=rewards');
        return;
      }
      setBoostyAccessError(err.message || 'Failed to load.');
    } finally {
      boostyAccessLoadingRef.current = false;
      setBoostyAccessLoading(false);
    }
  }, [effectiveChannelId, t]);

  const redirectToDiscordLink = useCallback(() => {
    const apiOrigin = typeof window !== 'undefined' ? getApiOriginForRedirect() : '';
    if (!apiOrigin) return;
    const url = new URL(`${apiOrigin}/auth/discord/link`);
    url.searchParams.set('origin', window.location.origin);
    url.searchParams.set('redirect_to', '/settings?tab=rewards');
    window.location.href = url.toString();
  }, []);

  // Auto-refresh on entering screen.
  useEffect(() => {
    void refreshBoostyAccess();
  }, [refreshBoostyAccess]);

  const loadRewardSettings = useCallback(async () => {
    if (!user?.channel?.slug) return;
    
    if (settingsLoadedRef.current === user.channel.slug) {
      return;
    }
    
    try {
      const cached = getCachedChannelData(user.channel.slug);
      if (cached) {
        const legacyCoins =
          typeof cached.submissionRewardCoins === 'number' ? cached.submissionRewardCoins : 0;
        const uploadCoins =
          typeof cached.submissionRewardCoinsUpload === 'number' ? cached.submissionRewardCoinsUpload : legacyCoins;
        const poolCoins =
          typeof cached.submissionRewardCoinsPool === 'number' ? cached.submissionRewardCoinsPool : legacyCoins;
        setRewardSettings({
          rewardIdForCoins: cached.rewardIdForCoins || '',
          rewardEnabled: cached.rewardEnabled || false,
          rewardTitle: cached.rewardTitle || '',
          rewardCost: cached.rewardCost ? String(cached.rewardCost) : '',
          rewardCoins: cached.rewardCoins ? String(cached.rewardCoins) : '',
          rewardOnlyWhenLive: getBoolean(cached, 'rewardOnlyWhenLive') ?? false,
          submissionRewardCoinsUpload: String(uploadCoins ?? 0),
          submissionRewardCoinsPool: String(poolCoins ?? 0),
          submissionRewardOnlyWhenLive:
            getBoolean(cached, 'submissionRewardOnlyWhenLive') ?? false,
        });
        settingsLoadedRef.current = user.channel.slug;
        lastSavedTwitchRef.current = JSON.stringify({
          rewardIdForCoins: cached.rewardIdForCoins || null,
          rewardEnabled: cached.rewardEnabled || false,
          rewardTitle: cached.rewardTitle || null,
          rewardCost: cached.rewardCost ?? null,
          rewardCoins: cached.rewardCoins ?? null,
          rewardOnlyWhenLive: getBoolean(cached, 'rewardOnlyWhenLive') ?? false,
        });
        lastSavedApprovedRef.current = JSON.stringify({
          submissionRewardCoinsUpload: uploadCoins ?? 0,
          submissionRewardCoinsPool: poolCoins ?? 0,
          submissionRewardOnlyWhenLive:
            getBoolean(cached, 'submissionRewardOnlyWhenLive') ?? false,
        });
        const boostyBlogName = typeof cached.boostyBlogName === 'string' ? cached.boostyBlogName : '';
        const boostyCoinsPerSub = typeof cached.boostyCoinsPerSub === 'number' ? cached.boostyCoinsPerSub : 0;
        const boostyTierCoinsRaw = Array.isArray(cached.boostyTierCoins) ? cached.boostyTierCoins : [];
        const boostyTierCoins = boostyTierCoinsRaw
          .map((x) => ({
            tierKey: typeof (x as { tierKey?: unknown }).tierKey === 'string' ? String((x as { tierKey?: unknown }).tierKey) : '',
            coins: typeof (x as { coins?: unknown }).coins === 'number' ? String((x as { coins?: unknown }).coins) : '',
          }))
          .filter((x) => x.tierKey || x.coins);
        setBoostySettings({
          boostyBlogName,
          boostyCoinsPerSub: String(boostyCoinsPerSub ?? 0),
          boostyTierCoins,
        });
        lastSavedBoostyRef.current = JSON.stringify({
          boostyBlogName: boostyBlogName.trim() ? boostyBlogName : null,
          boostyCoinsPerSub: boostyCoinsPerSub ?? 0,
          boostyTierCoins: boostyTierCoinsRaw,
        });
        setBoostyTierErrors({ table: null, rows: {} });
        return;
      }

      const channelData = await getChannelData(user.channel.slug);
      if (channelData) {
        const legacyCoins =
          typeof channelData.submissionRewardCoins === 'number' ? channelData.submissionRewardCoins : 0;
        const uploadCoins =
          typeof channelData.submissionRewardCoinsUpload === 'number' ? channelData.submissionRewardCoinsUpload : legacyCoins;
        const poolCoins =
          typeof channelData.submissionRewardCoinsPool === 'number' ? channelData.submissionRewardCoinsPool : legacyCoins;
        setRewardSettings({
          rewardIdForCoins: channelData.rewardIdForCoins || '',
          rewardEnabled: channelData.rewardEnabled || false,
          rewardTitle: channelData.rewardTitle || '',
          rewardCost: channelData.rewardCost ? String(channelData.rewardCost) : '',
          rewardCoins: channelData.rewardCoins ? String(channelData.rewardCoins) : '',
          rewardOnlyWhenLive: getBoolean(channelData, 'rewardOnlyWhenLive') ?? false,
          submissionRewardCoinsUpload: String(uploadCoins ?? 0),
          submissionRewardCoinsPool: String(poolCoins ?? 0),
          submissionRewardOnlyWhenLive:
            getBoolean(channelData, 'submissionRewardOnlyWhenLive') ?? false,
        });
        settingsLoadedRef.current = user.channel.slug;
        lastSavedTwitchRef.current = JSON.stringify({
          rewardIdForCoins: channelData.rewardIdForCoins || null,
          rewardEnabled: channelData.rewardEnabled || false,
          rewardTitle: channelData.rewardTitle || null,
          rewardCost: channelData.rewardCost ?? null,
          rewardCoins: channelData.rewardCoins ?? null,
          rewardOnlyWhenLive: getBoolean(channelData, 'rewardOnlyWhenLive') ?? false,
        });
        lastSavedApprovedRef.current = JSON.stringify({
          submissionRewardCoinsUpload: uploadCoins ?? 0,
          submissionRewardCoinsPool: poolCoins ?? 0,
          submissionRewardOnlyWhenLive:
            getBoolean(channelData, 'submissionRewardOnlyWhenLive') ?? false,
        });
        const boostyBlogName = typeof channelData.boostyBlogName === 'string' ? channelData.boostyBlogName : '';
        const boostyCoinsPerSub = typeof channelData.boostyCoinsPerSub === 'number' ? channelData.boostyCoinsPerSub : 0;
        const boostyTierCoinsRaw = Array.isArray(channelData.boostyTierCoins) ? channelData.boostyTierCoins : [];
        const boostyTierCoins = boostyTierCoinsRaw
          .map((x) => ({
            tierKey: typeof (x as { tierKey?: unknown }).tierKey === 'string' ? String((x as { tierKey?: unknown }).tierKey) : '',
            coins: typeof (x as { coins?: unknown }).coins === 'number' ? String((x as { coins?: unknown }).coins) : '',
          }))
          .filter((x) => x.tierKey || x.coins);
        setBoostySettings({
          boostyBlogName,
          boostyCoinsPerSub: String(boostyCoinsPerSub ?? 0),
          boostyTierCoins,
        });
        lastSavedBoostyRef.current = JSON.stringify({
          boostyBlogName: boostyBlogName.trim() ? boostyBlogName : null,
          boostyCoinsPerSub: boostyCoinsPerSub ?? 0,
          boostyTierCoins: boostyTierCoinsRaw,
        });
        setBoostyTierErrors({ table: null, rows: {} });
      }
    } catch (error) {
      settingsLoadedRef.current = null;
    }
  }, [user?.channel?.slug, getChannelData, getCachedChannelData]);

  useEffect(() => {
    if (user?.channelId && user?.channel?.slug) {
      loadRewardSettings();
    } else {
      settingsLoadedRef.current = null;
    }
  }, [loadRewardSettings, user?.channelId, user?.channel?.slug]);

  // Track last non-zero value for the approved meme reward toggle.
  useEffect(() => {
    const uploadCoins = rewardSettings.submissionRewardCoinsUpload ? parseInt(rewardSettings.submissionRewardCoinsUpload, 10) : 0;
    if (Number.isFinite(uploadCoins) && uploadCoins > 0) {
      lastApprovedNonZeroRef.current = uploadCoins;
    }
    const poolCoins = rewardSettings.submissionRewardCoinsPool ? parseInt(rewardSettings.submissionRewardCoinsPool, 10) : 0;
    if (Number.isFinite(poolCoins) && poolCoins > 0) {
      lastApprovedNonZeroPoolRef.current = poolCoins;
    }
  }, [rewardSettings.submissionRewardCoinsUpload, rewardSettings.submissionRewardCoinsPool]);

  // Check Twitch reward eligibility (affiliate/partner) to hide/disable reward UI.
  useEffect(() => {
    if (!user?.channelId) return;
    let cancelled = false;
    (async () => {
      try {
        setEligibilityLoading(true);
        const { api } = await import('@/lib/api');
        const res = await api.get<{ eligible: boolean | null; broadcasterType?: string | null; checkedBroadcasterId?: string; reason?: string }>(
          '/streamer/twitch/reward/eligibility',
          { timeout: 15000 }
        );
        if (cancelled) return;
        // eligible can be null ("unknown") on beta when Twitch doesn't return channel info.
        setTwitchRewardEligible(res?.eligible === null ? null : !!res?.eligible);
        setLastErrorRequestId(null);
      } catch {
        if (!cancelled) setTwitchRewardEligible(null);
      } finally {
        if (!cancelled) setEligibilityLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.channelId]);

  const handleSaveTwitchReward = async () => {
    const startedAt = Date.now();
    setSavingTwitchReward(true);
    try {
      const { api } = await import('@/lib/api');
      // Ensure reward title is never empty when enabling (prevents 400s and creates a good default UX).
      const effectiveTitle =
        rewardSettings.rewardEnabled && !rewardSettings.rewardTitle.trim()
          ? t('admin.rewardTitlePlaceholder', { defaultValue: 'Get Coins' })
          : rewardSettings.rewardTitle;

      // Ensure reward cost/coins are never empty when enabling (prevents 400s; default 1000/1000).
      const effectiveCostStr =
        rewardSettings.rewardEnabled && !String(rewardSettings.rewardCost || '').trim() ? '1000' : rewardSettings.rewardCost;
      const effectiveCoinsStr =
        rewardSettings.rewardEnabled && !String(rewardSettings.rewardCoins || '').trim() ? '1000' : rewardSettings.rewardCoins;

      if (
        effectiveTitle !== rewardSettings.rewardTitle ||
        effectiveCostStr !== rewardSettings.rewardCost ||
        effectiveCoinsStr !== rewardSettings.rewardCoins
      ) {
        setRewardSettings((p) => ({
          ...p,
          rewardTitle: effectiveTitle,
          rewardCost: effectiveCostStr,
          rewardCoins: effectiveCoinsStr,
        }));
      }
      await api.patch('/streamer/channel/settings', {
        // Twitch reward only (do NOT include submissionRewardCoins here)
        rewardIdForCoins: rewardSettings.rewardIdForCoins || null,
        rewardEnabled: rewardSettings.rewardEnabled,
        rewardTitle: effectiveTitle || null,
        rewardCost: effectiveCostStr ? parseInt(effectiveCostStr, 10) : null,
        rewardCoins: effectiveCoinsStr ? parseInt(effectiveCoinsStr, 10) : null,
        rewardOnlyWhenLive: !!rewardSettings.rewardOnlyWhenLive,
      });
      lastSavedTwitchRef.current = JSON.stringify({
        rewardIdForCoins: rewardSettings.rewardIdForCoins || null,
        rewardEnabled: rewardSettings.rewardEnabled,
        rewardTitle: effectiveTitle || null,
        rewardCost: effectiveCostStr ? parseInt(effectiveCostStr, 10) : null,
        rewardCoins: effectiveCoinsStr ? parseInt(effectiveCoinsStr, 10) : null,
        rewardOnlyWhenLive: !!rewardSettings.rewardOnlyWhenLive,
      });
      setLastErrorRequestId(null);
    } catch (error: unknown) {
      const apiError = error as { response?: { status?: number; data?: { error?: string; errorCode?: string } } };
      const code = apiError.response?.data?.errorCode;
      const raw = apiError.response?.data?.error || '';
      const { getRequestIdFromError } = await import('@/lib/api');
      const rid = getRequestIdFromError(error);
      setLastErrorRequestId(rid);

      if (code === 'TWITCH_REWARD_NOT_AVAILABLE' || raw.includes("doesn't have partner") || raw.includes('affiliate')) {
        toast.error(t('admin.twitchRewardNotAvailable', { defaultValue: 'This Twitch reward is available only for affiliate/partner channels.' }));
        // Ensure UI doesn't stay enabled after a failed enable attempt.
        setRewardSettings((p) => ({ ...p, rewardEnabled: false }));
      } else if (code === 'REWARD_COST_COINS_REQUIRED' || raw.includes('Reward cost and coins are required')) {
        toast.error(t('admin.rewardCostCoinsRequired', { defaultValue: 'Reward cost and coins are required.' }));
      } else {
        const errorMessage = raw || t('admin.failedToSaveSettings') || 'Failed to save settings';
        toast.error(errorMessage);
      }

      if (apiError.response?.data && typeof apiError.response.data === 'object' && 'requiresReauth' in apiError.response.data) {
        setTimeout(() => {
          if (window.confirm(t('admin.requiresReauth') || 'You need to log out and log in again to enable Twitch rewards. Log out now?')) {
            window.location.href = '/';
          }
        }, 2000);
      }
    } finally {
      await ensureMinDuration(startedAt, 1000);
      setSavingTwitchReward(false);
      setTwitchSavedPulse(true);
      window.setTimeout(() => setTwitchSavedPulse(false), 700);
    }
  };

  const handleSaveApprovedMemeReward = async () => {
    const startedAt = Date.now();
    setSavingApprovedMemeReward(true);
    try {
      const uploadCoins = rewardSettings.submissionRewardCoinsUpload
        ? parseInt(rewardSettings.submissionRewardCoinsUpload, 10)
        : 0;
      const poolCoins = rewardSettings.submissionRewardCoinsPool ? parseInt(rewardSettings.submissionRewardCoinsPool, 10) : 0;

      if (Number.isNaN(uploadCoins) || uploadCoins < 0 || Number.isNaN(poolCoins) || poolCoins < 0) {
        toast.error(t('admin.invalidSubmissionRewardCoins', 'Введите корректное число (0 или больше)'));
        return;
      }
      const { api } = await import('@/lib/api');
      await api.patch('/streamer/channel/settings', {
        // Approved meme reward only (do NOT include Twitch reward fields here)
        submissionRewardCoinsUpload: uploadCoins,
        submissionRewardCoinsPool: poolCoins,
        submissionRewardOnlyWhenLive: !!rewardSettings.submissionRewardOnlyWhenLive,
      });
      lastSavedApprovedRef.current = JSON.stringify({
        submissionRewardCoinsUpload: uploadCoins,
        submissionRewardCoinsPool: poolCoins,
        submissionRewardOnlyWhenLive: !!rewardSettings.submissionRewardOnlyWhenLive,
      });
    } catch (error: unknown) {
      const apiError = error as { response?: { data?: { error?: string } } };
      const errorMessage = apiError.response?.data?.error || t('admin.failedToSaveSettings') || 'Failed to save settings';
      toast.error(errorMessage);
    } finally {
      await ensureMinDuration(startedAt, 1000);
      setSavingApprovedMemeReward(false);
      setApprovedSavedPulse(true);
      window.setTimeout(() => setApprovedSavedPulse(false), 700);
    }
  };

  // Autosave: Twitch reward fields (debounced)
  useEffect(() => {
    if (!user?.channel?.slug) return;
    if (!settingsLoadedRef.current) return;

    const payload = JSON.stringify({
      rewardIdForCoins: rewardSettings.rewardIdForCoins || null,
      rewardEnabled: rewardSettings.rewardEnabled,
      rewardTitle: rewardSettings.rewardTitle || null,
      rewardCost: rewardSettings.rewardCost ? parseInt(rewardSettings.rewardCost, 10) : null,
      rewardCoins: rewardSettings.rewardCoins ? parseInt(rewardSettings.rewardCoins, 10) : null,
      rewardOnlyWhenLive: !!rewardSettings.rewardOnlyWhenLive,
    });

    if (payload === lastSavedTwitchRef.current) return;
    if (saveTwitchTimerRef.current) window.clearTimeout(saveTwitchTimerRef.current);
    saveTwitchTimerRef.current = window.setTimeout(() => {
      void handleSaveTwitchReward();
    }, 500);

    return () => {
      if (saveTwitchTimerRef.current) window.clearTimeout(saveTwitchTimerRef.current);
      saveTwitchTimerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    rewardSettings.rewardIdForCoins,
    rewardSettings.rewardEnabled,
    rewardSettings.rewardTitle,
    rewardSettings.rewardCost,
    rewardSettings.rewardCoins,
    rewardSettings.rewardOnlyWhenLive,
    user?.channel?.slug,
  ]);

  // Autosave: Approved meme reward coins (debounced)
  useEffect(() => {
    if (!user?.channel?.slug) return;
    if (!settingsLoadedRef.current) return;

    const uploadCoins = rewardSettings.submissionRewardCoinsUpload
      ? parseInt(rewardSettings.submissionRewardCoinsUpload, 10)
      : 0;
    const poolCoins = rewardSettings.submissionRewardCoinsPool ? parseInt(rewardSettings.submissionRewardCoinsPool, 10) : 0;
    const payload = JSON.stringify({
      submissionRewardCoinsUpload: Number.isFinite(uploadCoins) ? uploadCoins : 0,
      submissionRewardCoinsPool: Number.isFinite(poolCoins) ? poolCoins : 0,
      submissionRewardOnlyWhenLive: !!rewardSettings.submissionRewardOnlyWhenLive,
    });

    if (payload === lastSavedApprovedRef.current) return;
    if (saveApprovedTimerRef.current) window.clearTimeout(saveApprovedTimerRef.current);
    saveApprovedTimerRef.current = window.setTimeout(() => {
      void handleSaveApprovedMemeReward();
    }, 500);

    return () => {
      if (saveApprovedTimerRef.current) window.clearTimeout(saveApprovedTimerRef.current);
      saveApprovedTimerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    rewardSettings.submissionRewardCoinsUpload,
    rewardSettings.submissionRewardCoinsPool,
    rewardSettings.submissionRewardOnlyWhenLive,
    user?.channel?.slug,
  ]);

  const saveBoostySettings = useCallback(async () => {
    if (!user?.channel?.slug) return;
    if (!settingsLoadedRef.current) return;
    if (savingBoosty) return;

    const blogNameTrimmed = (boostySettings.boostyBlogName || '').trim();
    const coinsPerSubRaw = String(boostySettings.boostyCoinsPerSub || '').trim();
    const coinsPerSub = parseIntSafe(coinsPerSubRaw || '0') ?? 0;

    const rowsErr: BoostyTierCoinsRowErrors = {};
    const sanitizedRows: Array<{ tierKey: string; coins: number }> = [];

    boostySettings.boostyTierCoins.forEach((row, idx) => {
      const tierKeyRaw = String(row.tierKey || '');
      const coinsRaw = String(row.coins || '');
      const isEmpty = !tierKeyRaw.trim() && !coinsRaw.trim();
      if (isEmpty) return;

      const tierKey = tierKeyRaw;
      const coinsStr = coinsRaw.trim();

      if (!tierKey.trim()) {
        rowsErr[idx] = { ...(rowsErr[idx] || {}), tierKey: t('admin.boostyTierKeyRequired', { defaultValue: 'Укажите tierKey.' }) };
      }

      if (!coinsStr) {
        rowsErr[idx] = { ...(rowsErr[idx] || {}), coins: t('admin.boostyCoinsRequired', { defaultValue: 'Укажите coins.' }) };
      } else {
        const n = parseIntSafe(coinsStr);
        if (n === null || !Number.isInteger(n)) {
          rowsErr[idx] = {
            ...(rowsErr[idx] || {}),
            coins: t('admin.boostyCoinsInvalid', { defaultValue: 'coins должно быть целым числом.' }),
          };
        } else if (n < 0 || n > 1_000_000) {
          rowsErr[idx] = {
            ...(rowsErr[idx] || {}),
            coins: t('admin.boostyCoinsRange', { defaultValue: 'coins должно быть в диапазоне 0..1_000_000.' }),
          };
        } else if (tierKey.trim()) {
          sanitizedRows.push({ tierKey, coins: n });
        }
      }
    });

    // Optional (UX): preflight duplicate tierKey (case-insensitive) before request.
    // Ignore incomplete rows (no coins yet) to avoid yelling while the user is still typing.
    // Backend validates this too, but highlighting duplicates locally reduces round-trips.
    const seenTierKeys = new Map<string, { idx: number; rawKey: string }>();
    boostySettings.boostyTierCoins.forEach((row, idx) => {
      const rawKey = String(row.tierKey || '').trim();
      const rawCoins = String(row.coins || '').trim();
      // ignore incomplete rows (UX)
      if (!rawKey || rawCoins === '') return;
      // ignore invalid coins rows (they already have/should have a coins error)
      const coins = parseIntSafe(rawCoins);
      if (coins === null) return;

      const key = rawKey.toLowerCase();
      const prev = seenTierKeys.get(key);
      if (!prev) {
        seenTierKeys.set(key, { idx, rawKey });
        return;
      }

      const msg = t('admin.boostyTierKeyDuplicate', {
        defaultValue: 'Duplicate tierKey (case-insensitive): {{tierKey}}',
        tierKey: `"${rawKey}" (${key})`,
      });
      if (!rowsErr[idx]?.tierKey) rowsErr[idx] = { ...(rowsErr[idx] || {}), tierKey: msg };
      if (!rowsErr[prev.idx]?.tierKey) rowsErr[prev.idx] = { ...(rowsErr[prev.idx] || {}), tierKey: msg };
    });

    // Front validation errors: show inline; do not send request.
    if (Object.keys(rowsErr).length > 0) {
      setBoostyTierErrors({ table: null, rows: rowsErr });
      return;
    }

    // Clear table errors before request; server-side Zod issues will be re-filled on failure.
    setBoostyTierErrors({ table: null, rows: {} });

    const payloadObj = {
      boostyBlogName: blogNameTrimmed ? blogNameTrimmed : null,
      boostyCoinsPerSub: Number.isFinite(coinsPerSub) ? coinsPerSub : 0,
      boostyTierCoins: sanitizedRows,
    };
    const payload = JSON.stringify(payloadObj);
    if (payload === lastSavedBoostyRef.current) return;

    const startedAt = Date.now();
    setSavingBoosty(true);
    try {
      const { api } = await import('@/lib/api');
      await api.patch('/streamer/channel/settings', payloadObj);
      lastSavedBoostyRef.current = payload;
    } catch (e) {
      const err = toApiError(e, t('admin.failedToSaveSettings', { defaultValue: 'Failed to save settings' }));

      if (err.errorCode === 'VALIDATION_ERROR' && Array.isArray(err.details)) {
        let table: string | null = null;
        const nextRows: BoostyTierCoinsRowErrors = {};

        for (const issue of err.details) {
          const msg = typeof (issue as { message?: unknown } | null)?.message === 'string' ? (issue as { message: string }).message : err.message;
          const path = (issue as { path?: unknown } | null)?.path;
          if (!Array.isArray(path)) continue;

          if (path.length === 1 && path[0] === 'boostyTierCoins') {
            table = msg;
            continue;
          }

          if (path[0] === 'boostyTierCoins' && typeof path[1] === 'number') {
            const idx = path[1];
            const field = path[2];
            if (field === 'tierKey') nextRows[idx] = { ...(nextRows[idx] || {}), tierKey: msg };
            else if (field === 'coins') nextRows[idx] = { ...(nextRows[idx] || {}), coins: msg };
            else nextRows[idx] = { ...(nextRows[idx] || {}), tierKey: msg };
          }
        }

        setBoostyTierErrors({ table, rows: nextRows });
        return; // Important: no toast on inline validation errors.
      }

      toast.error(err.error || err.message);
    } finally {
      await ensureMinDuration(startedAt, 650);
      setSavingBoosty(false);
      setBoostySavedPulse(true);
      window.setTimeout(() => setBoostySavedPulse(false), 700);
    }
  }, [boostySettings.boostyBlogName, boostySettings.boostyCoinsPerSub, boostySettings.boostyTierCoins, savingBoosty, t, user?.channel?.slug]);

  // Autosave: Boosty settings (debounced)
  useEffect(() => {
    if (!user?.channel?.slug) return;
    if (!settingsLoadedRef.current) return;
    if (saveBoostyTimerRef.current) window.clearTimeout(saveBoostyTimerRef.current);
    saveBoostyTimerRef.current = window.setTimeout(() => {
      void saveBoostySettings();
    }, 500);

    return () => {
      if (saveBoostyTimerRef.current) window.clearTimeout(saveBoostyTimerRef.current);
      saveBoostyTimerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boostySettings.boostyBlogName, boostySettings.boostyCoinsPerSub, boostySettings.boostyTierCoins, user?.channel?.slug]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold dark:text-white">{t('admin.rewards', { defaultValue: 'Награды' })}</h2>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
          {t('admin.rewardsDescription', { defaultValue: 'Настройка наград и начисления монет за действия зрителей.' })}
        </p>
        {/* Future: Add new reward button - пока скрыто, так как только одна награда */}
        {/* <button
          className="bg-primary hover:bg-secondary text-white font-semibold py-2 px-4 rounded-lg transition-colors"
          disabled
          title={t('admin.addRewardComingSoon', 'Скоро будет доступно')}
        >
          {t('admin.addReward', 'Добавить награду')}
        </button> */}
      </div>

      <div className="space-y-6">
        <SettingsSection
          title={t('admin.twitchCoinsRewardTitle', { defaultValue: 'Награда за монеты (Twitch)' })}
          description={t('admin.twitchCoinsRewardDescription', { defaultValue: 'Зритель тратит Channel Points на Twitch и получает монеты на сайте.' })}
          overlay={
            <>
              {savingTwitchReward && <SavingOverlay label={t('admin.saving', { defaultValue: 'Saving…' })} />}
              {twitchSavedPulse && !savingTwitchReward && <SavedOverlay label={t('admin.saved', { defaultValue: 'Saved' })} />}
            </>
          }
          right={
            <HelpTooltip content={t('help.settings.rewards.enableTwitchReward', { defaultValue: 'Turn the Twitch reward on/off (it gives coins to viewers).' })}>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={rewardSettings.rewardEnabled}
                  disabled={savingTwitchReward || eligibilityLoading || twitchRewardEligible === false || !twitchLinked}
                  onChange={(e) => {
                    if (!twitchLinked) {
                      toast.error(t('admin.twitchChannelNotLinked', { defaultValue: 'This channel is not linked to Twitch.' }));
                      return;
                    }
                    if (twitchRewardEligible === false) {
                      toast.error(
                        t('admin.twitchRewardNotAvailable', {
                          defaultValue: 'This Twitch reward is available only for affiliate/partner channels.',
                        })
                      );
                      return;
                    }
                    const nextEnabled = e.target.checked;
                    // Friendly defaults when enabling.
                    if (nextEnabled) {
                      setRewardSettings((p) => ({
                        ...p,
                        rewardEnabled: true,
                        rewardTitle: p.rewardTitle?.trim()
                          ? p.rewardTitle
                          : t('admin.rewardTitlePlaceholder', { defaultValue: 'Get Coins' }),
                        rewardCost: String(p.rewardCost || '').trim() ? p.rewardCost : '1000',
                        rewardCoins: String(p.rewardCoins || '').trim() ? p.rewardCoins : '1000',
                      }));
                      return;
                    }
                    setRewardSettings((p) => ({ ...p, rewardEnabled: false }));
                  }}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/20 dark:peer-focus:ring-primary/30 rounded-full peer dark:bg-gray-600 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-primary"></div>
              </label>
            </HelpTooltip>
          }
          contentClassName={rewardSettings.rewardEnabled ? 'space-y-4' : undefined}
        >
          {twitchRewardEligible === null && (
            <p className="text-sm text-yellow-700 dark:text-yellow-300">
              {t('admin.twitchEligibilityUnknown', {
                defaultValue:
                  "We couldn't verify Twitch eligibility right now. You can try enabling the reward; if it fails, log out and log in again.",
              })}
            </p>
          )}
          {lastErrorRequestId && (
            <p className="text-xs text-gray-600 dark:text-gray-400 select-text">
              {t('common.errorId', { defaultValue: 'Error ID' })}: <span className="font-mono">{lastErrorRequestId}</span>
            </p>
          )}
          {twitchRewardEligible === false && (
            <p className="text-sm text-yellow-700 dark:text-yellow-300">
              {t('admin.twitchRewardNotAvailable', {
                defaultValue: 'This Twitch reward is available only for affiliate/partner channels.',
              })}
            </p>
          )}
          {!twitchLinked && (
            <p className="text-sm text-yellow-700 dark:text-yellow-300">
              {t('admin.twitchChannelNotLinked', { defaultValue: 'This channel is not linked to Twitch.' })}
            </p>
          )}

          {rewardSettings.rewardEnabled && (
            <div className={savingTwitchReward ? 'pointer-events-none opacity-60' : ''}>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    {t('admin.rewardOnlyWhenLiveTitle', { defaultValue: 'Active only when stream is live' })}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    {t('admin.rewardOnlyWhenLiveHint', {
                      defaultValue: 'When enabled, the reward works only while your Twitch stream is online.',
                    })}
                  </div>
                </div>
                <HelpTooltip content={t('help.settings.rewards.onlyWhenLive', { defaultValue: 'If enabled, the reward works only when your stream is live.' })}>
                  <label className="relative inline-flex items-center cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    checked={rewardSettings.rewardOnlyWhenLive}
                    disabled={savingTwitchReward}
                    onChange={(e) => setRewardSettings((p) => ({ ...p, rewardOnlyWhenLive: e.target.checked }))}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/20 dark:peer-focus:ring-primary/30 rounded-full peer dark:bg-gray-600 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-primary"></div>
                  </label>
                </HelpTooltip>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {t('admin.rewardTitle')}
                </label>
                <Input
                  type="text"
                  value={rewardSettings.rewardTitle}
                  onChange={(e) => setRewardSettings({ ...rewardSettings, rewardTitle: e.target.value })}
                  placeholder={t('admin.rewardTitlePlaceholder')}
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="flex flex-col">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    {t('admin.rewardCost')}
                  </label>
                  <Input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={rewardSettings.rewardCost}
                    onChange={(e) => {
                      const next = e.target.value.replace(/[^\d]/g, '');
                      setRewardSettings({ ...rewardSettings, rewardCost: next });
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'e' || e.key === 'E' || e.key === '+' || e.key === '-' || e.key === '.') {
                        e.preventDefault();
                      }
                    }}
                    placeholder="100"
                    required={rewardSettings.rewardEnabled}
                  />
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 min-h-[2.25rem]">
                    {t('admin.rewardCostDescription')}
                  </p>
                </div>
                <div className="flex flex-col">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    {t('admin.rewardCoins')}
                  </label>
                  <Input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={rewardSettings.rewardCoins}
                    onChange={(e) => {
                      const next = e.target.value.replace(/[^\d]/g, '');
                      setRewardSettings({ ...rewardSettings, rewardCoins: next });
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'e' || e.key === 'E' || e.key === '+' || e.key === '-' || e.key === '.') {
                        e.preventDefault();
                      }
                    }}
                    placeholder="100"
                    required={rewardSettings.rewardEnabled}
                  />
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 min-h-[2.25rem]">
                    {t('admin.rewardCoinsDescription')}
                  </p>
                </div>
              </div>
              <div>
                <SecretCopyField
                  label={`${t('admin.rewardIdForCoins', { defaultValue: 'Reward ID' })} (${t('admin.autoGenerated', { defaultValue: 'auto-generated' })})`}
                  value={rewardSettings.rewardIdForCoins}
                  masked={true}
                  description={t('admin.rewardIdDescription', { defaultValue: 'Click to copy. Use the eye icon to reveal.' })}
                  emptyText={t('common.notSet', { defaultValue: 'Not set' })}
                />
              </div>
            </div>
          )}

          {/* Removed persistent Saved label; we show overlays instead to avoid noise. */}
        </SettingsSection>

        <SettingsSection
          title={t('admin.approvedMemeRewardTitle', { defaultValue: 'Награда за одобренный мем (монеты)' })}
          description={t('admin.approvedMemeRewardDescription', { defaultValue: 'Начисляется автору заявки после одобрения.' })}
          overlay={
            <>
              {savingApprovedMemeReward && <SavingOverlay label={t('admin.saving', { defaultValue: 'Saving…' })} />}
              {approvedSavedPulse && !savingApprovedMemeReward && <SavedOverlay label={t('admin.saved', { defaultValue: 'Saved' })} />}
            </>
          }
          right={
            <HelpTooltip content={t('help.settings.rewards.enableApprovedReward', { defaultValue: 'Give coins to the viewer when you approve their meme. Turn off = set both rewards to 0.' })}>
              <label className={`relative inline-flex items-center cursor-pointer shrink-0 ${savingApprovedMemeReward ? 'opacity-60 cursor-not-allowed' : ''}`}>
                <input
                  type="checkbox"
                  checked={
                    (parseInt(rewardSettings.submissionRewardCoinsUpload || '0', 10) || 0) > 0 ||
                    (parseInt(rewardSettings.submissionRewardCoinsPool || '0', 10) || 0) > 0
                  }
                  disabled={savingApprovedMemeReward}
                  onChange={(e) => {
                    if (savingApprovedMemeReward) return;
                    const enabled = e.target.checked;
                    if (!enabled) {
                      setRewardSettings({ ...rewardSettings, submissionRewardCoinsUpload: '0', submissionRewardCoinsPool: '0' });
                      return;
                    }
                    const restoreUpload = lastApprovedNonZeroRef.current > 0 ? lastApprovedNonZeroRef.current : 100;
                    const restorePool = lastApprovedNonZeroPoolRef.current > 0 ? lastApprovedNonZeroPoolRef.current : 100;
                    setRewardSettings({
                      ...rewardSettings,
                      submissionRewardCoinsUpload: String(restoreUpload),
                      submissionRewardCoinsPool: String(restorePool),
                    });
                  }}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/20 dark:peer-focus:ring-primary/30 rounded-full peer dark:bg-gray-600 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-primary"></div>
              </label>
            </HelpTooltip>
          }
        >

          <div className={savingApprovedMemeReward ? 'pointer-events-none opacity-60' : ''}>
            <div className="flex items-start justify-between gap-4 mb-3">
              <div className="min-w-0">
                <div className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  {t('admin.rewardOnlyWhenLiveTitle', { defaultValue: 'Active only when stream is live' })}
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  {t('admin.rewardOnlyWhenLiveHint', {
                    defaultValue: 'When enabled, the reward works only while your Twitch stream is online.',
                  })}
                </div>
              </div>
              <HelpTooltip content={t('help.settings.rewards.approvedOnlyWhenLive', { defaultValue: 'If enabled, coins are granted only when your stream is live.' })}>
                <label className={`relative inline-flex items-center cursor-pointer shrink-0 ${savingApprovedMemeReward ? 'opacity-60 cursor-not-allowed' : ''}`}>
                  <input
                    type="checkbox"
                    checked={rewardSettings.submissionRewardOnlyWhenLive}
                    disabled={savingApprovedMemeReward}
                    onChange={(e) => setRewardSettings((p) => ({ ...p, submissionRewardOnlyWhenLive: e.target.checked }))}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/20 dark:peer-focus:ring-primary/30 rounded-full peer dark:bg-gray-600 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-primary"></div>
                </label>
              </HelpTooltip>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <HelpTooltip content={t('help.settings.rewards.approvedUploadCoins', { defaultValue: 'How many coins the viewer gets when you approve a submission from upload/URL. Use 0 to disable.' })}>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    {t('admin.submissionRewardCoinsUpload', { defaultValue: 'Reward (upload / URL) (coins)' })}
                  </label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={rewardSettings.submissionRewardCoinsUpload}
                      onChange={(e) => {
                        const next = e.target.value.replace(/[^\d]/g, '');
                        setRewardSettings({ ...rewardSettings, submissionRewardCoinsUpload: next });
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'e' || e.key === 'E' || e.key === '+' || e.key === '-' || e.key === '.') {
                          e.preventDefault();
                        }
                      }}
                      placeholder="0"
                    />
                    <HelpTooltip content={t('help.settings.rewards.quickAdd100', { defaultValue: 'Quickly add +100 coins.' })}>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        className="shrink-0 glass-btn bg-white/40 dark:bg-white/5"
                        onClick={() => {
                          const current = rewardSettings.submissionRewardCoinsUpload
                            ? parseInt(rewardSettings.submissionRewardCoinsUpload, 10)
                            : 0;
                          const next = (Number.isFinite(current) ? current : 0) + 100;
                          setRewardSettings({ ...rewardSettings, submissionRewardCoinsUpload: String(next) });
                        }}
                        disabled={savingApprovedMemeReward}
                      >
                        {t('admin.quickAdd100', { defaultValue: '+100' })}
                      </Button>
                    </HelpTooltip>
                  </div>
                </div>
              </HelpTooltip>

              <HelpTooltip content={t('help.settings.rewards.approvedPoolCoins', { defaultValue: 'How many coins the viewer gets when you approve a submission from the Pool. Use 0 to disable.' })}>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    {t('admin.submissionRewardCoinsPool', { defaultValue: 'Reward (pool) (coins)' })}
                  </label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={rewardSettings.submissionRewardCoinsPool}
                      onChange={(e) => {
                        const next = e.target.value.replace(/[^\d]/g, '');
                        setRewardSettings({ ...rewardSettings, submissionRewardCoinsPool: next });
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'e' || e.key === 'E' || e.key === '+' || e.key === '-' || e.key === '.') {
                          e.preventDefault();
                        }
                      }}
                      placeholder="0"
                    />
                    <HelpTooltip content={t('help.settings.rewards.quickAdd100', { defaultValue: 'Quickly add +100 coins.' })}>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        className="shrink-0 glass-btn bg-white/40 dark:bg-white/5"
                        onClick={() => {
                          const current = rewardSettings.submissionRewardCoinsPool
                            ? parseInt(rewardSettings.submissionRewardCoinsPool, 10)
                            : 0;
                          const next = (Number.isFinite(current) ? current : 0) + 100;
                          setRewardSettings({ ...rewardSettings, submissionRewardCoinsPool: String(next) });
                        }}
                        disabled={savingApprovedMemeReward}
                      >
                        {t('admin.quickAdd100', { defaultValue: '+100' })}
                      </Button>
                    </HelpTooltip>
                  </div>
                </div>
              </HelpTooltip>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              {t('admin.submissionRewardCoinsDescriptionSplit', {
                defaultValue:
                  'Coins granted to the viewer when you approve their submission. Pool and upload/URL can have different rewards. Set 0 to disable.',
              })}
            </p>
          </div>

          {/* Removed persistent Saved label; we show overlays instead to avoid noise. */}
        </SettingsSection>

        <SettingsSection
          title={t('subscription.boostyAccessTitle', { defaultValue: 'Подписка / Boosty rewards' })}
          description={t('subscription.boostyAccessDescription', {
            defaultValue: 'Статус доступа определяется через Discord roles. Никаких Boosty-токенов больше не нужно.',
          })}
          right={
            <Button type="button" variant="secondary" onClick={() => void refreshBoostyAccess()} disabled={boostyAccessLoading}>
              {boostyAccessLoading ? t('common.loading', { defaultValue: 'Loading…' }) : t('common.refresh', { defaultValue: 'Проверить снова' })}
            </Button>
          }
        >
          {!effectiveChannelId ? (
            <div className="text-sm text-gray-600 dark:text-gray-300">
              {t('subscription.boostyAccessNoChannel', { defaultValue: 'Не удалось определить channelId.' })}
            </div>
          ) : boostyAccess ? (
            <div className="space-y-3">
              <div className="text-sm text-gray-700 dark:text-gray-200">
                {t('subscription.boostyAccessRequiredGuild', { defaultValue: 'Discord сервер (guildId)' })}:{' '}
                <span className="font-mono">{boostyAccess.requiredGuild.guildId}</span>
                {boostyAccess.requiredGuild.name ? (
                  <span className="ml-2 text-gray-500 dark:text-gray-400">({boostyAccess.requiredGuild.name})</span>
                ) : null}
              </div>

              {boostyAccess.status === 'need_discord_link' ? (
                <div className="rounded-xl bg-white/40 dark:bg-white/5 ring-1 ring-black/5 dark:ring-white/10 p-4">
                  <div className="font-semibold text-gray-900 dark:text-white">
                    {t('subscription.boostyAccessNeedDiscordTitle', { defaultValue: 'Нужно привязать Discord' })}
                  </div>
                  <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                    {t('subscription.boostyAccessNeedDiscordBody', { defaultValue: 'Привяжите Discord, затем мы проверим роли на сервере.' })}
                  </div>
                  <div className="mt-3">
                    <Button type="button" variant="primary" onClick={redirectToDiscordLink}>
                      {t('subscription.boostyAccessLinkDiscordCta', { defaultValue: 'Привязать Discord' })}
                    </Button>
                  </div>
                </div>
              ) : null}

              {boostyAccess.status === 'need_join_guild' ? (
                <div className="rounded-xl bg-white/40 dark:bg-white/5 ring-1 ring-black/5 dark:ring-white/10 p-4">
                  <div className="font-semibold text-gray-900 dark:text-white">
                    {t('subscription.boostyAccessNeedJoinTitle', { defaultValue: 'Нужно быть на Discord‑сервере' })}
                  </div>
                  <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                    {boostyAccess.requiredGuild.autoJoin
                      ? t('subscription.boostyAccessAutoJoinHint', {
                          defaultValue:
                            'После привязки Discord мы попробуем добавить вас автоматически. Если не получилось — вступите по инвайту.',
                        })
                      : t('subscription.boostyAccessManualJoinHint', {
                          defaultValue: 'Вступите на сервер и нажмите “Проверить снова”.',
                        })}
                  </div>
                  {boostyAccess.requiredGuild.inviteUrl ? (
                    <div className="mt-3 flex items-center gap-2">
                      <a href={boostyAccess.requiredGuild.inviteUrl} target="_blank" rel="noreferrer">
                        <Button type="button" variant="secondary">
                          {t('subscription.boostyAccessJoinCta', { defaultValue: 'Вступить' })}
                        </Button>
                      </a>
                    </div>
                  ) : (
                    <div className="mt-3 text-sm text-gray-600 dark:text-gray-300">
                      {t('subscription.boostyAccessNoInvite', {
                        defaultValue: 'Инвайт пока недоступен. Попросите ссылку у стримера/на сайте и затем нажмите “Проверить снова”.',
                      })}
                    </div>
                  )}
                </div>
              ) : null}

              {boostyAccess.status === 'not_subscribed' ? (
                <div className="rounded-xl bg-white/40 dark:bg-white/5 ring-1 ring-black/5 dark:ring-white/10 p-4">
                  <div className="font-semibold text-gray-900 dark:text-white">
                    {t('subscription.boostyAccessNotSubscribedTitle', { defaultValue: 'Подписка не найдена' })}
                  </div>
                  <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                    {t('subscription.boostyAccessNotSubscribedBody', {
                      defaultValue: 'Проверьте, что вы подключили Discord в Boosty и что Boosty выдал роль на сервере.',
                    })}
                  </div>
                </div>
              ) : null}

              {boostyAccess.status === 'subscribed' ? (
                <div className="rounded-xl bg-emerald-500/10 ring-1 ring-emerald-500/20 p-4">
                  <div className="font-semibold text-emerald-900 dark:text-emerald-100">
                    {t('subscription.boostyAccessSubscribedTitle', { defaultValue: 'Подписка активна' })}
                  </div>
                  {boostyAccess.matchedTier ? (
                    <div className="mt-1 text-sm text-emerald-900/80 dark:text-emerald-100/80">
                      {t('subscription.boostyAccessTier', { defaultValue: 'Tier' })}:{' '}
                      <span className="font-mono">{boostyAccess.matchedTier}</span>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : boostyAccessError ? (
            <div className="text-sm text-red-600 dark:text-red-400">{boostyAccessError}</div>
          ) : (
            <div className="text-sm text-gray-600 dark:text-gray-300">
              {t('common.loading', { defaultValue: 'Loading…' })}
            </div>
          )}
        </SettingsSection>

        <SettingsSection
          title={t('admin.boostyRewardsTitle', { defaultValue: 'Boosty' })}
          description={t('admin.boostyRewardsDescription', {
            defaultValue: 'Настройка наград за подписку Boosty (fallback и таблица tier→coins).',
          })}
          overlay={
            <>
              {savingBoosty && <SavingOverlay label={t('admin.saving', { defaultValue: 'Saving…' })} />}
              {boostySavedPulse && !savingBoosty && <SavedOverlay label={t('admin.saved', { defaultValue: 'Saved' })} />}
            </>
          }
        >
          <div className={savingBoosty ? 'pointer-events-none opacity-60' : ''}>
            {(() => {
              const fallback = parseIntSafe(String(boostySettings.boostyCoinsPerSub || '0')) ?? 0;
              const hasAnyTier = boostySettings.boostyTierCoins.some((r) => {
                const key = String(r.tierKey || '').trim();
                const coinsStr = String(r.coins || '').trim();
                if (!key || coinsStr === '') return false;
                const coins = parseIntSafe(coinsStr);
                return coins !== null && coins > 0;
              });
              if (fallback > 0 || hasAnyTier) return null;
              return (
                <div className="mb-4 rounded-xl bg-yellow-500/10 ring-1 ring-yellow-500/20 p-4 text-sm text-yellow-800 dark:text-yellow-200">
                  {t('admin.boostyRewardsDisabledWarning', {
                    defaultValue:
                      'Награды отключены: укажите fallback (boostyCoinsPerSub) или таблицу tier→coins, иначе монеты начисляться не будут.',
                  })}
                </div>
              );
            })()}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {t('admin.boostyBlogName', { defaultValue: 'boostyBlogName' })}
                </label>
                <Input
                  type="text"
                  value={boostySettings.boostyBlogName}
                  onChange={(e) => {
                    setBoostySettings((p) => ({ ...p, boostyBlogName: e.target.value }));
                    // Clear any table-level error (e.g. server validation) once user edits inputs.
                    setBoostyTierErrors((prev) => (prev.table ? { ...prev, table: null } : prev));
                  }}
                  placeholder={t('admin.boostyBlogNamePlaceholder', { defaultValue: 'например: memalerts' })}
                />
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  {t('admin.boostyBlogNameHint', {
                    defaultValue: 'Какой Boosty-блог считать “подпиской на канал”.',
                  })}
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {t('admin.boostyCoinsPerSub', { defaultValue: 'boostyCoinsPerSub (fallback)' })}
                </label>
                <Input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={boostySettings.boostyCoinsPerSub}
                  onChange={(e) => {
                    const next = e.target.value.replace(/[^\d]/g, '');
                    setBoostySettings((p) => ({ ...p, boostyCoinsPerSub: next }));
                    setBoostyTierErrors((prev) => (prev.table ? { ...prev, table: null } : prev));
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'e' || e.key === 'E' || e.key === '+' || e.key === '-' || e.key === '.') {
                      e.preventDefault();
                    }
                  }}
                  placeholder="0"
                />
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  {t('admin.boostyCoinsPerSubHint', { defaultValue: 'Награда по умолчанию, если tier не сопоставлен (0 = отключить).' })}
                </p>
              </div>
            </div>

            <div className="mt-4">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-semibold text-gray-900 dark:text-white">
                  {t('admin.boostyTierCoinsTitle', { defaultValue: 'boostyTierCoins (tier→coins)' })}
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="glass-btn bg-white/40 dark:bg-white/5"
                  onClick={() => {
                    setBoostySettings((p) => ({ ...p, boostyTierCoins: [...p.boostyTierCoins, { tierKey: '', coins: '' }] }));
                    // Indices-based errors would shift; simplest UX is to clear and re-validate on save.
                    setBoostyTierErrors({ table: null, rows: {} });
                  }}
                >
                  {t('admin.addRow', { defaultValue: 'Добавить строку' })}
                </Button>
              </div>

              {boostyTierErrors.table ? (
                <div className="mt-2 text-sm text-red-600 dark:text-red-400">{boostyTierErrors.table}</div>
              ) : null}

              <div className="mt-3 space-y-2">
                {boostySettings.boostyTierCoins.length === 0 ? (
                  <div className="text-sm text-gray-600 dark:text-gray-300">
                    {t('admin.boostyTierCoinsEmpty', { defaultValue: 'Таблица пуста.' })}
                  </div>
                ) : (
                  boostySettings.boostyTierCoins.map((row, idx) => {
                    const rowErr = boostyTierErrors.rows[idx] || {};
                    return (
                      <div
                        key={idx}
                        className="grid grid-cols-1 sm:grid-cols-[1fr_180px_auto] gap-2 items-start rounded-xl bg-white/30 dark:bg-white/5 ring-1 ring-black/5 dark:ring-white/10 p-3"
                      >
                        <div>
                          <label className="block text-xs font-semibold text-gray-700 dark:text-gray-200 mb-1">
                            {t('admin.boostyTierKey', { defaultValue: 'tierKey' })}
                          </label>
                          <Input
                            type="text"
                            value={row.tierKey}
                            hasError={!!rowErr.tierKey}
                            onChange={(e) => {
                              const v = e.target.value;
                              setBoostySettings((p) => ({
                                ...p,
                                boostyTierCoins: p.boostyTierCoins.map((r, i) => (i === idx ? { ...r, tierKey: v } : r)),
                              }));
                              setBoostyTierErrors((prev) => {
                                const cur = prev.rows[idx];
                                if (!prev.table && !cur?.tierKey) return prev;
                                const nextRows = { ...prev.rows };
                                if (cur) {
                                  const nextRow = { ...cur };
                                  delete nextRow.tierKey;
                                  if (Object.keys(nextRow).length === 0) {
                                    delete nextRows[idx];
                                  } else {
                                    nextRows[idx] = nextRow;
                                  }
                                }
                                return { table: null, rows: nextRows };
                              });
                            }}
                            placeholder="tier-1"
                          />
                          {rowErr.tierKey ? <div className="mt-1 text-xs text-red-600 dark:text-red-400">{rowErr.tierKey}</div> : null}
                        </div>

                        <div>
                          <label className="block text-xs font-semibold text-gray-700 dark:text-gray-200 mb-1">
                            {t('admin.boostyCoins', { defaultValue: 'coins' })}
                          </label>
                          <Input
                            type="text"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            value={row.coins}
                            hasError={!!rowErr.coins}
                            onChange={(e) => {
                              const v = e.target.value.replace(/[^\d]/g, '');
                              setBoostySettings((p) => ({
                                ...p,
                                boostyTierCoins: p.boostyTierCoins.map((r, i) => (i === idx ? { ...r, coins: v } : r)),
                              }));
                              setBoostyTierErrors((prev) => {
                                const cur = prev.rows[idx];
                                if (!prev.table && !cur?.coins) return prev;
                                const nextRows = { ...prev.rows };
                                if (cur) {
                                  const nextRow = { ...cur };
                                  delete nextRow.coins;
                                  if (Object.keys(nextRow).length === 0) {
                                    delete nextRows[idx];
                                  } else {
                                    nextRows[idx] = nextRow;
                                  }
                                }
                                return { table: null, rows: nextRows };
                              });
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'e' || e.key === 'E' || e.key === '+' || e.key === '-' || e.key === '.') {
                                e.preventDefault();
                              }
                            }}
                            placeholder="0"
                          />
                          {row.coins === '0' ? (
                            <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                              {t('admin.boostyCoinsZeroHint', { defaultValue: '0 отключает награду для этого tier.' })}
                            </div>
                          ) : null}
                          {rowErr.coins ? <div className="mt-1 text-xs text-red-600 dark:text-red-400">{rowErr.coins}</div> : null}
                        </div>

                        <div className="pt-6 flex justify-end">
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            className="glass-btn bg-white/40 dark:bg-white/5"
                            onClick={() => {
                              setBoostySettings((p) => ({
                                ...p,
                                boostyTierCoins: p.boostyTierCoins.filter((_, i) => i !== idx),
                              }));
                              // Clear errors to avoid index mismatch.
                              setBoostyTierErrors({ table: null, rows: {} });
                            }}
                          >
                            {t('common.remove', { defaultValue: 'Remove' })}
                          </Button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </SettingsSection>
      </div>
    </div>
  );
}


