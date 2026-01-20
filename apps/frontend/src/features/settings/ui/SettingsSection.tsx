import type { ReactNode } from 'react';

import { cn } from '@/shared/lib/cn';

export type SettingsSectionProps = {
  title: ReactNode;
  description?: ReactNode;
  right?: ReactNode;
  /** Absolute overlays that should cover the whole section (e.g. SavingOverlay). */
  overlay?: ReactNode;
  children?: ReactNode;
  className?: string;
  contentClassName?: string;
};

/**
 * Unified visual building block for settings tabs.
 * Uses `glass` surface per project style guide, with consistent spacing/typography.
 */
export function SettingsSection({
  title,
  description,
  right,
  overlay,
  children,
  className,
  contentClassName,
}: SettingsSectionProps) {
  return (
    <section className={cn('glass p-5 sm:p-6 relative', className)}>
      {/* Keep overlays above header + content (overlay is expected to be absolutely positioned). */}
      {/** NOTE: Rendering first ensures correct stacking without relying on z-index wars. */}
      {overlay}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white leading-snug">{title}</h3>
          {description ? <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">{description}</div> : null}
        </div>
        {right ? <div className="shrink-0">{right}</div> : null}
      </div>
      {children ? <div className={cn('mt-4', contentClassName)}>{children}</div> : null}
    </section>
  );
}


