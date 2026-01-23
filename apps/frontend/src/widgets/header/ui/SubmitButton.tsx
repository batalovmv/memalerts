import { Button, HelpTooltip } from '@/shared/ui';

type SubmitButtonProps = {
  onClick: () => void;
  label: string;
  tooltip: string;
  ariaLabel: string;
};

export function SubmitButton({ onClick, label, tooltip, ariaLabel }: SubmitButtonProps) {
  return (
    <HelpTooltip content={tooltip}>
      <Button
        onClick={onClick}
        variant="ghost"
        size="sm"
        leftIcon={
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
        }
        className="text-primary"
        aria-label={ariaLabel}
      >
        <span className="text-sm hidden sm:inline">{label}</span>
      </Button>
    </HelpTooltip>
  );
}
