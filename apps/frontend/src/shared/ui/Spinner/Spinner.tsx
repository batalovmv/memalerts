import { cn } from '@/shared/lib/cn';

export type SpinnerProps = {
  className?: string;
};

export function Spinner({ className }: SpinnerProps) {
  return (
    <span
      className={cn(
        'inline-block h-4 w-4 rounded-full border-2 border-gray-300/70 dark:border-gray-600/70 border-t-primary animate-spin',
        className,
      )}
      aria-hidden="true"
    />
  );
}


