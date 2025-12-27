import { cloneElement, type ReactElement, type ReactNode, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { cn } from '@/shared/lib/cn';

type TooltipPlacement = 'top' | 'bottom';

export type TooltipProps = {
  content: ReactNode;
  delayMs?: number;
  placement?: TooltipPlacement;
  className?: string;
  children: ReactElement;
};

type Pos = { left: number; top: number; placement: TooltipPlacement } | null;

export function Tooltip({ content, delayMs = 1000, placement = 'top', className, children }: TooltipProps) {
  const tooltipId = useId();
  const openTimerRef = useRef<number | null>(null);
  const anchorRef = useRef<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<Pos>(null);

  const contentStr = useMemo(() => {
    if (typeof content === 'string') return content.trim();
    return '';
  }, [content]);

  function clearTimer() {
    if (openTimerRef.current !== null) {
      window.clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
  }

  function updatePosition() {
    const el = anchorRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();

    const centerX = r.left + r.width / 2;
    const preferTop = placement === 'top';
    const topY = r.top - 10;
    const bottomY = r.bottom + 10;

    const canTop = topY > 8;
    const effPlacement: TooltipPlacement = preferTop ? (canTop ? 'top' : 'bottom') : 'bottom';

    setPos({
      left: Math.round(centerX),
      top: Math.round(effPlacement === 'top' ? topY : bottomY),
      placement: effPlacement,
    });
  }

  function scheduleOpen() {
    clearTimer();
    openTimerRef.current = window.setTimeout(() => {
      setOpen(true);
    }, Math.max(0, delayMs));
  }

  function close() {
    clearTimer();
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    updatePosition();

    const onScroll = () => updatePosition();
    const onResize = () => updatePosition();

    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    return () => clearTimer();
  }, []);

  const child = cloneElement(children, {
    ref: (node: unknown) => {
      // Best-effort ref forwarding (supports DOM nodes + components that forwardRef).
      anchorRef.current = node as HTMLElement | null;

      const prevRef = (children as unknown as { ref?: unknown }).ref;
      if (typeof prevRef === 'function') prevRef(node);
      else if (prevRef && typeof prevRef === 'object') (prevRef as { current?: unknown }).current = node;
    },
    onMouseEnter: (e: unknown) => {
      (children.props as { onMouseEnter?: (e: unknown) => void }).onMouseEnter?.(e);
      scheduleOpen();
    },
    onMouseLeave: (e: unknown) => {
      (children.props as { onMouseLeave?: (e: unknown) => void }).onMouseLeave?.(e);
      close();
    },
    onFocus: (e: unknown) => {
      (children.props as { onFocus?: (e: unknown) => void }).onFocus?.(e);
      scheduleOpen();
    },
    onBlur: (e: unknown) => {
      (children.props as { onBlur?: (e: unknown) => void }).onBlur?.(e);
      close();
    },
    ...(contentStr ? { 'aria-describedby': tooltipId } : {}),
  });

  return (
    <>
      {child}
      {open && content ? (
        createPortal(
          <div
            id={tooltipId}
            role="tooltip"
            className={cn(
              'fixed z-[9999] max-w-[320px] rounded-lg bg-gray-900 px-3 py-2 text-xs leading-snug text-white shadow-xl pointer-events-none',
              className,
            )}
            style={
              pos
                ? {
                    left: pos.left,
                    top: pos.top,
                    transform: pos.placement === 'top' ? 'translate(-50%, -100%)' : 'translate(-50%, 0%)',
                  }
                : { left: 0, top: 0, transform: 'translate(-9999px, -9999px)' }
            }
          >
            {content}
          </div>,
          document.body,
        )
      ) : null}
    </>
  );
}


