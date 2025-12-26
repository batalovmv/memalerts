import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

import { cn } from '@/shared/lib/cn';

export type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  icon: ReactNode;
  variant?: 'primary' | 'success' | 'warning' | 'danger' | 'secondary' | 'ghost';
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, variant = 'ghost', className, disabled, ...props },
  ref,
) {
  const base =
    'inline-flex items-center justify-center gap-2 rounded-xl font-semibold leading-none transition-[transform,background-color,box-shadow,opacity] select-none [-webkit-tap-highlight-color:transparent] active:translate-y-[0.5px] disabled:opacity-60 disabled:pointer-events-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent';
  const iconOnly = 'p-2 w-9 h-9';
  const variantClass: Record<NonNullable<IconButtonProps['variant']>, string> = {
    primary: 'bg-primary text-white shadow-[0_10px_18px_rgba(10,132,255,0.2)] hover:brightness-[0.98]',
    success: 'bg-emerald-600 text-white shadow-[0_10px_18px_rgba(16,185,129,0.22)] hover:bg-emerald-700',
    warning: 'bg-amber-600 text-white shadow-[0_10px_18px_rgba(245,158,11,0.22)] hover:bg-amber-700',
    danger: 'bg-rose-600 text-white shadow-[0_10px_18px_rgba(244,63,94,0.22)] hover:bg-rose-700',
    secondary:
      'text-gray-900 dark:text-white bg-white/65 dark:bg-white/10 shadow-sm ring-1 ring-black/5 dark:ring-white/10',
    ghost: 'text-gray-900 dark:text-white hover:bg-black/5 dark:hover:bg-white/10',
  };

  return (
    <button
      ref={ref}
      {...props}
      disabled={disabled}
      className={cn(base, iconOnly, variantClass[variant], className)}
    >
      <span aria-hidden="true">{icon}</span>
    </button>
  );
});


