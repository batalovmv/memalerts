import type { ReactNode } from 'react';

import { cn } from '@/shared/lib/cn';

export type PageShellVariant = 'plain' | 'glass' | 'channel';

export type PageShellProps = {
  header?: ReactNode;
  /** Optional background layer (absolute, pointer-events-none recommended). */
  background?: ReactNode;
  variant?: PageShellVariant;
  children: ReactNode;
  className?: string;
  mainClassName?: string;
  containerClassName?: string;
};

function defaultBackground(): ReactNode {
  // Subtle “iOS-ish” accents based on global CSS vars.
  // Note: color-mix is already used on channel pages, so we reuse the same approach.
  const mix = (cssVar: '--primary-color' | '--secondary-color' | '--accent-color', percent: number) =>
    `color-mix(in srgb, var(${cssVar}) ${percent}%, transparent)`;

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0"
      style={{
        backgroundImage: [
          `radial-gradient(70% 60% at 14% 12%, ${mix('--primary-color', 14)} 0%, transparent 62%)`,
          `radial-gradient(60% 55% at 88% 16%, ${mix('--secondary-color', 12)} 0%, transparent 64%)`,
          `radial-gradient(70% 60% at 55% 90%, ${mix('--accent-color', 10)} 0%, transparent 64%)`,
          `linear-gradient(135deg, ${mix('--primary-color', 8)} 0%, transparent 45%, ${mix('--secondary-color', 8)} 100%)`,
        ].join(', '),
      }}
    />
  );
}

export function PageShell({
  header,
  background,
  variant = 'plain',
  className,
  mainClassName,
  containerClassName,
  children,
}: PageShellProps) {
  const showDefaultBackground = variant !== 'channel' && !background;

  return (
    <div className={cn('relative overflow-hidden', className)}>
      {background}
      {showDefaultBackground ? defaultBackground() : null}

      {header}

      <main className={cn('relative page-container py-8', containerClassName, mainClassName)}>{children}</main>
    </div>
  );
}


