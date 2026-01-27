import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { ChannelEconomy } from '@memalerts/api-contracts';

import { Button } from '@/shared/ui';

type StreamerProfileEconomyProps = {
  economy?: ChannelEconomy;
  isAuthed: boolean;
  onClaimDaily: () => void;
  onClaimWatch: () => void;
  claimingDaily: boolean;
  claimingWatch: boolean;
  onRequireAuth: () => void;
};

function formatCooldown(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${total}s`;
}

export function StreamerProfileEconomy({
  economy,
  isAuthed,
  onClaimDaily,
  onClaimWatch,
  claimingDaily,
  claimingWatch,
  onRequireAuth,
}: StreamerProfileEconomyProps) {
  const { t } = useTranslation();
  const [, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const isLive = economy?.stream?.status === 'online';
  const dailyCoins = economy?.computed?.dailyBonusCoins ?? 0;
  const watchCoins = economy?.computed?.watchBonusCoins ?? 0;
  const daily = economy?.viewer?.daily;
  const watch = economy?.viewer?.watch;
  const streakCount = daily?.streakCount ?? null;
  const streakMultiplier = daily?.streakMultiplier ?? null;

  const dailyCooldown = daily?.cooldownSecondsRemaining ?? 0;
  const watchCooldown = watch?.cooldownSecondsRemaining ?? 0;
  const dailyNextLabel = formatCooldown(dailyCooldown);
  const watchNextLabel = formatCooldown(watchCooldown);

  const dailyDisabled = claimingDaily || (isAuthed && !daily?.canClaim);
  const watchDisabled = claimingWatch || (isAuthed && !watch?.canClaim);

  const dailyHint = useMemo(() => {
    if (!isAuthed) return t('economy.loginToClaim', { defaultValue: 'Log in to claim bonuses.' });
    if (!dailyCoins) return t('economy.bonusUnavailable', { defaultValue: 'Bonus unavailable.' });
    if (daily?.canClaim) return t('economy.dailyReady', { defaultValue: 'Available now' });
    if (dailyNextLabel) return t('economy.nextAvailable', { defaultValue: 'Next in {{time}}', time: dailyNextLabel });
    return t('economy.dailyCooldown', { defaultValue: 'Daily bonus on cooldown' });
  }, [daily?.canClaim, dailyCoins, dailyNextLabel, isAuthed, t]);

  const watchHint = useMemo(() => {
    if (!isAuthed) return t('economy.loginToClaim', { defaultValue: 'Log in to claim bonuses.' });
    if (!isLive) return t('economy.watchOffline', { defaultValue: 'Stream is offline.' });
    if (!watchCoins) return t('economy.bonusUnavailable', { defaultValue: 'Bonus unavailable.' });
    if (watch?.canClaim) return t('economy.watchReady', { defaultValue: 'Available now' });
    if (watchNextLabel) return t('economy.nextAvailable', { defaultValue: 'Next in {{time}}', time: watchNextLabel });
    return t('economy.watchCooldown', { defaultValue: 'Watch bonus on cooldown' });
  }, [isAuthed, isLive, watchCoins, watch?.canClaim, watchNextLabel, t]);

  const claimsLabel = watch
    ? t('economy.watchClaims', {
        defaultValue: '{{used}} / {{max}} per stream',
        used: watch.claimsThisStream,
        max: watch.maxClaimsPerStream,
      })
    : '';

  const handleDailyClick = () => {
    if (!isAuthed) {
      onRequireAuth();
      return;
    }
    if (dailyDisabled) return;
    onClaimDaily();
  };

  const handleWatchClick = () => {
    if (!isAuthed) {
      onRequireAuth();
      return;
    }
    if (watchDisabled) return;
    onClaimWatch();
  };

  if (!economy) return null;

  return (
    <section className="mb-4 rounded-xl border border-white/10 bg-white/70 dark:bg-white/5 p-3 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-semibold text-gray-900 dark:text-white">
          {t('economy.title', { defaultValue: 'Bonuses' })}
        </div>
        <div
          className={`text-xs font-semibold ${isLive ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-500 dark:text-gray-400'}`}
        >
          {isLive ? t('economy.live', { defaultValue: 'Live' }) : t('economy.offline', { defaultValue: 'Offline' })}
        </div>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-black/5 dark:border-white/10 bg-white/60 dark:bg-gray-900/40 p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-gray-900 dark:text-white">
                {t('economy.dailyTitle', { defaultValue: 'Daily bonus' })}
              </div>
              <div className="text-xs text-gray-600 dark:text-gray-300 mt-1">
                {t('economy.dailyAmount', { defaultValue: '+{{count}} coins', count: dailyCoins })}
              </div>
            </div>
            <Button type="button" size="sm" variant="primary" disabled={dailyDisabled} onClick={handleDailyClick}>
              {claimingDaily
                ? t('economy.claiming', { defaultValue: 'Claiming...' })
                : t('economy.claim', { defaultValue: 'Claim' })}
            </Button>
          </div>
          <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">{dailyHint}</div>
          {streakCount && streakMultiplier ? (
            <div className="mt-1 text-xs text-emerald-600 dark:text-emerald-400">
              {t('economy.streak', { defaultValue: 'Streak {{count}} · x{{mult}}', count: streakCount, mult: streakMultiplier })}
            </div>
          ) : null}
        </div>

        <div className="rounded-lg border border-black/5 dark:border-white/10 bg-white/60 dark:bg-gray-900/40 p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-gray-900 dark:text-white">
                {t('economy.watchTitle', { defaultValue: 'Watch bonus' })}
              </div>
              <div className="text-xs text-gray-600 dark:text-gray-300 mt-1">
                {t('economy.watchAmount', { defaultValue: '+{{count}} coins', count: watchCoins })}
              </div>
            </div>
            <Button type="button" size="sm" variant="secondary" disabled={watchDisabled} onClick={handleWatchClick}>
              {claimingWatch
                ? t('economy.claiming', { defaultValue: 'Claiming...' })
                : t('economy.watchButton', { defaultValue: "I'm watching" })}
            </Button>
          </div>
          <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">{watchHint}</div>
          {claimsLabel ? <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">{claimsLabel}</div> : null}
        </div>
      </div>
    </section>
  );
}
