import { useEffect, useRef, type ReactNode } from 'react';

import { focusSafely, getFocusableElements } from '@/shared/lib/a11y/focus';
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
  const dialogRef = useRef<HTMLDivElement>(null);
  const lastActiveElementRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    lastActiveElementRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const raf = window.requestAnimationFrame(() => {
      const dialogEl = dialogRef.current;
      if (!dialogEl) return;
      const focusables = getFocusableElements(dialogEl);
      focusSafely(focusables[0] ?? dialogEl);
    });

    return () => {
      window.cancelAnimationFrame(raf);
      const lastActive = lastActiveElementRef.current;
      lastActiveElementRef.current = null;
      if (lastActive?.isConnected) focusSafely(lastActive);
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      className={cn(
        'fixed inset-0 flex items-end sm:items-center justify-center p-4 pb-safe bg-black/25 backdrop-blur-sm modal-backdrop-in',
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
        tabIndex={-1}
        ref={dialogRef}
        className={cn(
          'w-full rounded-t-3xl sm:rounded-2xl shadow-xl ring-1 ring-black/5 dark:ring-white/10 modal-pop-in focus:outline-none focus-visible:ring-2 focus-visible:ring-primary',
          // Use glass blur, but make the modal panel less see-through than raw `.glass`.
          useGlass && 'glass bg-white/80 dark:bg-gray-900/70',
          contentClassName,
        )}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDownCapture={(e) => {
          if (closeOnEsc && e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            onClose();
            return;
          }

          if (e.key !== 'Tab') return;
          const dialogEl = dialogRef.current;
          if (!dialogEl) return;

          const focusables = getFocusableElements(dialogEl);
          if (focusables.length === 0) {
            e.preventDefault();
            focusSafely(dialogEl);
            return;
          }

          const active = document.activeElement;
          const first = focusables[0];
          const last = focusables[focusables.length - 1];

          // If focus escaped for any reason, bring it back.
          if (!(active instanceof HTMLElement) || !dialogEl.contains(active)) {
            e.preventDefault();
            focusSafely(first);
            return;
          }

          if (e.shiftKey) {
            if (active === first) {
              e.preventDefault();
              focusSafely(last);
            }
          } else {
            if (active === last) {
              e.preventDefault();
              focusSafely(first);
            }
          }
        }}
      >
        {children}
      </div>
    </div>
  );
}


