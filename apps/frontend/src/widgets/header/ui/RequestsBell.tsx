import { HelpTooltip, Pill } from '@/shared/ui';

type RequestsBellProps = {
  count: number;
  isLoading: boolean;
  title: string;
  tooltip: string;
  onClick: () => void;
  showMenu?: boolean;
  menuId?: string;
  isMenuOpen?: boolean;
};

export function RequestsBell({
  count,
  isLoading,
  title,
  tooltip,
  onClick,
  showMenu = false,
  menuId,
  isMenuOpen,
}: RequestsBellProps) {
  return (
    <HelpTooltip content={tooltip}>
      <button
        type="button"
        onClick={onClick}
        className={`relative p-2 rounded-lg transition-colors ${
          count > 0 ? 'hover:bg-gray-100 dark:hover:bg-gray-700' : 'opacity-60 hover:bg-gray-50 dark:hover:bg-gray-800'
        }`}
        aria-label={title}
        aria-haspopup={showMenu ? 'menu' : undefined}
        aria-expanded={showMenu ? isMenuOpen : undefined}
        aria-controls={showMenu ? menuId : undefined}
      >
        <svg
          className={`w-6 h-6 transition-colors ${count > 0 ? 'text-primary' : 'text-gray-400 dark:text-gray-500'}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
          />
        </svg>

        {count > 0 && !isLoading && (
          <Pill variant="dangerSolid" className="absolute -top-1 -right-1 w-5 h-5 p-0 text-[11px] font-bold leading-none">
            {count}
          </Pill>
        )}
      </button>
    </HelpTooltip>
  );
}
