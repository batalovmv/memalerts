import { forwardRef, type TextareaHTMLAttributes } from 'react';

import { cn } from '@/shared/lib/cn';

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  hasError?: boolean;
};

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea({ hasError, className, ...props }, ref) {
  return (
    <textarea
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


