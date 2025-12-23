import type { ButtonHTMLAttributes, ReactNode } from 'react';

import { cn } from '@/shared/lib/cn';

export type ButtonVariant = 'primary' | 'success' | 'warning' | 'danger' | 'secondary' | 'ghost';
export type ButtonSize = 'sm' | 'md' | 'lg';

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
};

const base =
  'inline-flex items-center justify-center gap-2 rounded-xl font-semibold leading-none transition-[transform,background-color,box-shadow,opacity] select-none [-webkit-tap-highlight-color:transparent] active:translate-y-[0.5px] disabled:opacity-60 disabled:pointer-events-none';

const sizeClass: Record<ButtonSize, string> = {
  sm: 'px-3 py-2 text-sm',
  md: 'px-3.5 py-2.5 text-sm',
  lg: 'px-4 py-3 text-base',
};

const variantClass: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-white shadow-[0_10px_18px_rgba(10,132,255,0.2)] hover:brightness-[0.98]',
  success: 'bg-emerald-600 text-white shadow-[0_10px_18px_rgba(16,185,129,0.22)] hover:bg-emerald-700',
  warning: 'bg-amber-600 text-white shadow-[0_10px_18px_rgba(245,158,11,0.22)] hover:bg-amber-700',
  danger: 'bg-rose-600 text-white shadow-[0_10px_18px_rgba(244,63,94,0.22)] hover:bg-rose-700',
  secondary:
    'text-gray-900 dark:text-white bg-white/65 dark:bg-white/10 shadow-sm ring-1 ring-black/5 dark:ring-white/10',
  ghost: 'text-gray-900 dark:text-white hover:bg-black/5 dark:hover:bg-white/10',
};

export function Button({
  variant = 'secondary',
  size = 'md',
  leftIcon,
  rightIcon,
  className,
  disabled,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      disabled={disabled}
      className={cn(base, sizeClass[size], variantClass[variant], className)}
    >
      {leftIcon ? <span aria-hidden="true">{leftIcon}</span> : null}
      {children}
      {rightIcon ? <span aria-hidden="true">{rightIcon}</span> : null}
    </button>
  );
}


