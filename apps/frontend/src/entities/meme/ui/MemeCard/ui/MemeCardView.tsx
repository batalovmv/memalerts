import type { Meme } from '@/types';
import type { RefObject } from 'react';

import { cn } from '@/shared/lib/cn';

export type MemeCardViewProps = {
  meme: Meme;
  mediaUrl: string;
  previewMode: 'hoverWithSound' | 'hoverMuted' | 'autoplayMuted';
  aspectRatio: number;
  isHovered: boolean;
  shouldLoadMedia: boolean;
  videoMuted: boolean;
  setCardEl: (node: HTMLElement | null) => void;
  videoRef: RefObject<HTMLVideoElement>;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onClick: () => void;
  onMouseDown: () => void;
  onTouchStart: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
};

export function MemeCardView({
  meme,
  mediaUrl,
  previewMode,
  aspectRatio,
  isHovered,
  shouldLoadMedia,
  videoMuted,
  setCardEl,
  videoRef,
  onMouseEnter,
  onMouseLeave,
  onClick,
  onMouseDown,
  onTouchStart,
  onKeyDown,
}: MemeCardViewProps) {
  return (
    <article
      ref={setCardEl}
      className={cn(
        'block w-full overflow-hidden rounded-xl cursor-pointer break-inside-avoid mb-3',
        'bg-white/60 dark:bg-white/5 ring-1 ring-black/5 dark:ring-white/10 shadow-sm',
        'will-change-transform transition-[transform,box-shadow] duration-200 ease-out',
        'hover:-translate-y-[1px] hover:shadow-[0_10px_25px_rgba(0,0,0,0.10)] dark:hover:shadow-[0_10px_25px_rgba(0,0,0,0.45)]',
        'focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent',
      )}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={onClick}
      onMouseDown={onMouseDown}
      onTouchStart={onTouchStart}
      role="button"
      tabIndex={0}
      aria-label={`View meme: ${meme.title}`}
      onKeyDown={onKeyDown}
    >
      <div className="relative w-full bg-gray-900" style={{ aspectRatio }}>
        {!shouldLoadMedia ? (
          <div className="w-full h-full bg-gray-900" aria-hidden="true" />
        ) : meme.type === 'video' ? (
          <video
            ref={videoRef}
            src={mediaUrl}
            muted={videoMuted}
            autoPlay={previewMode === 'autoplayMuted'}
            loop
            playsInline
            className="w-full h-full object-contain"
            preload="metadata"
            aria-label={`Video preview: ${meme.title}`}
          />
        ) : (
          <img src={mediaUrl} alt={meme.title} className="w-full h-full object-contain" loading="lazy" />
        )}
        {isHovered && (
          <div
            className="absolute bottom-0 left-0 right-0 bg-black/70 text-white p-2 text-center transition-opacity duration-200 z-10"
            aria-label={`Meme title: ${meme.title}`}
          >
            <p className="text-sm font-medium truncate px-2">{meme.title}</p>
          </div>
        )}
      </div>
    </article>
  );
}


