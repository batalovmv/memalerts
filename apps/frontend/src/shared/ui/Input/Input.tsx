import { forwardRef, type InputHTMLAttributes } from 'react';

import { cn } from '@/shared/lib/cn';

export type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  hasError?: boolean;
};

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ hasError, className, ...props }, ref) {
  return (
    <input
      ref={ref}
      {...props}
      className={cn(
        'w-full rounded-xl px-3 py-2.5 text-sm bg-white/60 dark:bg-white/10 text-gray-900 dark:text-white shadow-sm outline-none',
        'focus:ring-2 focus:ring-primary/40',
        hasError && 'ring-2 ring-rose-500/40 focus:ring-rose-500/40',
        className,
      )}
    />
  );
});


