import { useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

import SecretCopyField from '@/components/SecretCopyField';
import { useChannelColors } from '@/contexts/ChannelColorsContext';
import { SettingsSection } from '@/features/settings/ui/SettingsSection';
import { ensureMinDuration } from '@/shared/lib/ensureMinDuration';
import { Button, Input } from '@/shared/ui';
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
  const [savingTwitchReward, setSavingTwitchReward] = useState(false);
  const [savingApprovedMemeReward, setSavingApprovedMemeReward] = useState(false);
  const [twitchSavedPulse, setTwitchSavedPulse] = useState(false);
  const [approvedSavedPulse, setApprovedSavedPulse] = useState(false);
  const lastApprovedNonZeroRef = useRef<number>(100);
  const lastApprovedNonZeroPoolRef = useRef<number>(100);
  const saveTwitchTimerRef = useRef<number | null>(null);
  const saveApprovedTimerRef = useRef<number | null>(null);
  const lastSavedTwitchRef = useRef<string | null>(null);
  const lastSavedApprovedRef = useRef<string | null>(null);
  const settingsLoadedRef = useRef<string | null>(null);

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
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                </div>
              </div>

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
                </div>
              </div>
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
      </div>
    </div>
  );
}


