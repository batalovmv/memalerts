import type { HTMLAttributes, ReactNode } from 'react';

import { cn } from '@/shared/lib/cn';

export type CardProps = HTMLAttributes<HTMLDivElement> & {
  hoverable?: boolean;
  children: ReactNode;
};

export function Card({ hoverable, className, ...props }: CardProps) {
  return (
    <div
      {...props}
      className={cn(
        'surface',
        hoverable && 'surface-hover',
        className,
      )}
    />
  );
}


