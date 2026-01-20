import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';

import { cn } from '@/shared/lib/cn';

export type PillVariant = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'successSolid' | 'dangerSolid';
export type PillSize = 'sm' | 'md';

export type PillProps = Omit<HTMLAttributes<HTMLSpanElement>, 'children'> & {
  children: ReactNode;
  variant?: PillVariant;
  size?: PillSize;
};

const base =
  'inline-flex items-center justify-center rounded-full font-semibold ring-1 ring-black/5 dark:ring-white/10';

const sizeClass: Record<PillSize, string> = {
  sm: 'text-xs px-2.5 py-1',
  md: 'text-sm px-3 py-1.5',
};

const variantClass: Record<PillVariant, string> = {
  neutral: 'bg-white/60 dark:bg-white/10 text-gray-800 dark:text-gray-200',
  primary: 'bg-primary/15 text-primary ring-primary/20',
  success: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 ring-emerald-500/20',
  successSolid: 'bg-emerald-600 text-white ring-0',
  warning: 'bg-amber-500/15 text-amber-800 dark:text-amber-300 ring-amber-500/20',
  danger: 'bg-rose-500/15 text-rose-700 dark:text-rose-300 ring-rose-500/20',
  dangerSolid: 'bg-rose-600 text-white ring-0',
};

export const Pill = forwardRef<HTMLSpanElement, PillProps>(function Pill(
  { children, variant = 'neutral', size = 'sm', className, ...props },
  ref,
) {
  return (
    <span ref={ref} {...props} className={cn(base, sizeClass[size], variantClass[variant], className)}>
      {children}
    </span>
  );
});


