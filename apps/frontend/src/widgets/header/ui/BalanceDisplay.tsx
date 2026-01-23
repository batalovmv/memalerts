import { HelpTooltip, Pill } from '@/shared/ui';

type BalanceDisplayProps = {
  balance: number;
  isInfinite?: boolean;
  isLoading?: boolean;
  coinIconUrl?: string | null;
  coinUpdateDelta?: number | null;
  onClick?: () => void;
  tooltip: string;
  ariaLabel: string;
  coinAlt?: string;
};

export function BalanceDisplay({
  balance,
  isInfinite = false,
  isLoading = false,
  coinIconUrl,
  coinUpdateDelta = null,
  onClick,
  tooltip,
  ariaLabel,
  coinAlt = 'Coin',
}: BalanceDisplayProps) {
  return (
    <div className="relative group">
      <HelpTooltip content={tooltip}>
        <button
          type="button"
          className="flex items-center gap-2 px-2 sm:px-3 py-2 rounded-xl bg-primary/10 dark:bg-primary/20 shadow-sm ring-1 ring-black/5 dark:ring-white/10"
          onClick={onClick}
          aria-label={ariaLabel}
        >
          {coinIconUrl ? (
            <img src={coinIconUrl} alt={coinAlt} className="w-5 h-5" />
          ) : (
            <svg className="w-5 h-5 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          )}
          <div className="flex items-baseline gap-1">
            <span className="text-sm sm:text-base font-bold text-gray-900 dark:text-white">
              {isInfinite ? '∞' : isLoading ? '...' : balance}
            </span>
            <span className="text-xs text-gray-600 dark:text-gray-400 hidden sm:inline">coins</span>
          </div>
        </button>
      </HelpTooltip>
      {coinUpdateDelta !== null && coinUpdateDelta > 0 && (
        <Pill variant="successSolid" size="sm" className="absolute -top-1 -right-1 text-[10px] px-2 py-0.5 font-bold shadow">
          +{coinUpdateDelta}
        </Pill>
      )}
    </div>
  );
}
