import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { WheelSpin, WheelState } from '@memalerts/api-contracts';

import { Button, Spinner } from '@/shared/ui';

const formatCooldown = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${total}s`;
};

type StreamerProfileWheelProps = {
  state: WheelState | null;
  lastSpin: WheelSpin | null;
  lastSpinEvent: { displayName: string | null; prize: { coins: number; label: string } } | null;
  loading: boolean;
  spinning: boolean;
  isAuthed: boolean;
  onSpin: (mode: 'free' | 'paid') => Promise<unknown> | void;
  onRequireAuth: () => void;
};

export function StreamerProfileWheel({
  state,
  lastSpin,
  lastSpinEvent,
  loading,
  spinning,
  isAuthed,
  onSpin,
  onRequireAuth,
}: StreamerProfileWheelProps) {
  const { t } = useTranslation();

  const freeCooldown = state ? formatCooldown(state.freeSpinCooldownSeconds ?? 0) : '';
  const freeAvailable = state?.freeSpinAvailable ?? false;
  const paidCost = state?.paidSpinCostCoins ?? 0;

  const lastWinnerLabel = useMemo(() => {
    if (lastSpinEvent?.displayName && lastSpinEvent.prize) {
      return `${lastSpinEvent.displayName} · +${lastSpinEvent.prize.coins}`;
    }
    if (lastSpin?.prize) {
      return `+${lastSpin.prize.coins}`;
    }
    return '';
  }, [lastSpin?.prize, lastSpinEvent]);

  const handleSpin = (mode: 'free' | 'paid') => {
    if (!isAuthed) {
      onRequireAuth();
      return;
    }
    onSpin(mode);
  };

  return (
    <section className="rounded-xl border border-white/10 bg-white/70 dark:bg-white/5 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-gray-900 dark:text-white">
            {t('wheel.title', { defaultValue: 'Wheel of Fortune' })}
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400">
            {state?.enabled === false
              ? t('wheel.disabled', { defaultValue: 'Wheel disabled by streamer' })
              : t('wheel.subtitle', { defaultValue: 'Free spin daily + paid spins' })}
          </div>
        </div>
        {loading ? (
          <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
            <Spinner className="h-3 w-3" />
            {t('wheel.loading', { defaultValue: 'Loading…' })}
          </div>
        ) : null}
      </div>

      {state && state.enabled !== false ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto] items-center">
          <div className="text-xs text-gray-600 dark:text-gray-300">
            {freeAvailable
              ? t('wheel.freeReady', { defaultValue: 'Free spin available now' })
              : freeCooldown
                ? t('wheel.freeCooldown', { defaultValue: 'Free spin in {{time}}', time: freeCooldown })
                : t('wheel.freeCooldown', { defaultValue: 'Free spin in {{time}}', time: '—' })}
            <div className="mt-1">
              {t('wheel.paidCost', { defaultValue: 'Paid spin cost: {{count}} coins', count: paidCost })}
            </div>
            {state.prizeMultiplier && state.prizeMultiplier !== 1 ? (
              <div className="mt-1">
                {t('wheel.multiplier', { defaultValue: 'Prize multiplier ×{{count}}', count: state.prizeMultiplier })}
              </div>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            {freeAvailable ? (
              <Button type="button" size="sm" variant="primary" onClick={() => handleSpin('free')} disabled={spinning}>
                {spinning ? t('wheel.spinning', { defaultValue: 'Spinning…' }) : t('wheel.spinFree', { defaultValue: 'Free spin' })}
              </Button>
            ) : null}
            <Button type="button" size="sm" variant={freeAvailable ? 'secondary' : 'primary'} onClick={() => handleSpin('paid')} disabled={spinning}>
              {spinning ? t('wheel.spinning', { defaultValue: 'Spinning…' }) : t('wheel.spinPaid', { defaultValue: 'Spin for {{count}}', count: paidCost })}
            </Button>
          </div>
        </div>
      ) : null}

      {lastWinnerLabel ? (
        <div className="mt-3 text-xs text-gray-500 dark:text-gray-400">
          {t('wheel.lastSpin', { defaultValue: 'Last spin' })}: {lastWinnerLabel}
        </div>
      ) : null}
    </section>
  );
}
