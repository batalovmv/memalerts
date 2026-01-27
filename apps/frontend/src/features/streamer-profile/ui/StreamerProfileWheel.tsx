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

  const hasState = !!state;
  const isEnabled = state?.enabled !== false;
  if (!loading && (!hasState || !isEnabled)) return null;

  const freeCooldown = state ? formatCooldown(state.freeSpinCooldownSeconds ?? 0) : '';
  const freeAvailable = state?.freeSpinAvailable ?? false;
  const paidCost = state?.paidSpinCostCoins ?? 0;

  const lastWinnerLabel =
    lastSpinEvent?.displayName && lastSpinEvent.prize
      ? `${lastSpinEvent.displayName} · +${lastSpinEvent.prize.coins}`
      : lastSpin?.prize
        ? `+${lastSpin.prize.coins}`
        : '';

  const handleSpin = (mode: 'free' | 'paid') => {
    if (!isAuthed) {
      onRequireAuth();
      return;
    }
    onSpin(mode);
  };

  return (
    <section className="rounded-xl border border-white/10 bg-white/60 dark:bg-white/5 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-gray-900 dark:text-white">
            {t('wheel.title', { defaultValue: 'Wheel of Fortune' })}
          </div>
          {state ? (
            <div className="text-xs text-gray-500 dark:text-gray-400">
              {freeAvailable
                ? t('wheel.freeReady', { defaultValue: 'Free spin available now' })
                : freeCooldown
                  ? t('wheel.freeCooldown', { defaultValue: 'Free spin in {{time}}', time: freeCooldown })
                  : t('wheel.subtitle', { defaultValue: 'Free spin daily + paid spins' })}
              <div className="mt-1">
                {t('wheel.paidCost', { defaultValue: 'Paid spin cost: {{count}} coins', count: paidCost })}
              </div>
              {state.prizeMultiplier && state.prizeMultiplier !== 1 ? (
                <div className="mt-1">
                  {t('wheel.multiplier', { defaultValue: 'Prize multiplier ×{{count}}', count: state.prizeMultiplier })}
                </div>
              ) : null}
            </div>
          ) : (
            <div className="text-xs text-gray-500 dark:text-gray-400">
              {t('wheel.loading', { defaultValue: 'Loading…' })}
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {loading ? (
            <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
              <Spinner className="h-3 w-3" />
              {t('wheel.loading', { defaultValue: 'Loading…' })}
            </div>
          ) : state ? (
            isAuthed ? (
              <>
                {freeAvailable ? (
                  <Button type="button" size="sm" variant="primary" onClick={() => handleSpin('free')} disabled={spinning}>
                    {spinning ? t('wheel.spinning', { defaultValue: 'Spinning…' }) : t('wheel.spinFree', { defaultValue: 'Free spin' })}
                  </Button>
                ) : null}
                <Button type="button" size="sm" variant={freeAvailable ? 'secondary' : 'primary'} onClick={() => handleSpin('paid')} disabled={spinning}>
                  {spinning ? t('wheel.spinning', { defaultValue: 'Spinning…' }) : t('wheel.spinPaid', { defaultValue: 'Spin for {{count}}', count: paidCost })}
                </Button>
              </>
            ) : (
              <Button type="button" size="sm" variant="secondary" onClick={onRequireAuth}>
                {t('auth.login', { defaultValue: 'Log in' })}
              </Button>
            )
          ) : null}
        </div>
      </div>

      {lastWinnerLabel ? (
        <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
          {t('wheel.lastSpin', { defaultValue: 'Last spin' })}: {lastWinnerLabel}
        </div>
      ) : null}
    </section>
  );
}
