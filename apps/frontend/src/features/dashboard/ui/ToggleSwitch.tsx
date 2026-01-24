import { Spinner } from '@/shared/ui';

type ToggleSwitchProps = {
  checked: boolean;
  disabled?: boolean;
  busy?: boolean;
  onChange: (next: boolean) => void;
  ariaLabel?: string;
};

export function ToggleSwitch({ checked, disabled, busy, onChange, ariaLabel }: ToggleSwitchProps) {
  const isDisabled = !!disabled || !!busy;
  return (
    <label className={`relative inline-flex items-center cursor-pointer shrink-0 ${isDisabled ? 'opacity-80' : ''}`}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="sr-only peer"
        disabled={isDisabled}
        aria-label={ariaLabel}
      />
      <div
        className={[
          'relative w-11 h-6 rounded-full transition-colors',
          'bg-gray-200 dark:bg-gray-600',
          'peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/20 dark:peer-focus:ring-primary/30',
          'peer-checked:bg-primary',
        ].join(' ')}
      >
        <div
          className={[
            'absolute top-[2px] left-[2px] h-5 w-5 rounded-full bg-white border border-gray-300 dark:border-gray-600',
            'transition-transform',
            checked ? 'translate-x-full' : 'translate-x-0',
            busy ? 'grid place-items-center' : '',
          ].join(' ')}
        >
          {busy ? <Spinner className="h-3 w-3 border-[2px]" /> : null}
        </div>
      </div>
    </label>
  );
}
