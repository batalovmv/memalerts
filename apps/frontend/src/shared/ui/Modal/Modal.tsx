import type { ReactNode } from 'react';
import { useEffect } from 'react';

import { cn } from '@/shared/lib/cn';

export type ModalProps = {
  isOpen: boolean;
  onClose: () => void;
  children: ReactNode;
  /**
   * Prefer ariaLabelledBy when you render a visible title element.
   * Otherwise, provide ariaLabel.
   */
  ariaLabel?: string;
  ariaLabelledBy?: string;
  closeOnBackdrop?: boolean;
  closeOnEsc?: boolean;
  useGlass?: boolean;
  overlayClassName?: string;
  contentClassName?: string;
  zIndexClassName?: string;
};

export function Modal({
  isOpen,
  onClose,
  children,
  ariaLabel,
  ariaLabelledBy,
  closeOnBackdrop = true,
  closeOnEsc = true,
  useGlass = true,
  overlayClassName,
  contentClassName,
  zIndexClassName = 'z-50',
}: ModalProps) {
  useEffect(() => {
    if (!isOpen) return;
    if (!closeOnEsc) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, closeOnEsc, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className={cn(
        'fixed inset-0 flex items-end sm:items-center justify-center p-4 pb-safe bg-black/50 modal-backdrop-in',
        zIndexClassName,
        overlayClassName,
      )}
      role="presentation"
      onMouseDown={(e) => {
        if (!closeOnBackdrop) return;
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabelledBy ? undefined : ariaLabel}
        aria-labelledby={ariaLabelledBy}
        className={cn(
          'w-full rounded-t-3xl sm:rounded-2xl shadow-2xl modal-pop-in',
          useGlass && 'glass',
          contentClassName,
        )}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}


