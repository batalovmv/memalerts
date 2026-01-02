import type { Meme } from '@/types';
import type { RefObject } from 'react';

import { cn } from '@/shared/lib/cn';
import { Tooltip } from '@/shared/ui';

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
  const aiTags = Array.isArray((meme as Meme).aiAutoTagNames) ? (meme as Meme).aiAutoTagNames!.filter((x) => typeof x === 'string') : [];
  const aiDesc = typeof (meme as Meme).aiAutoDescription === 'string' ? ((meme as Meme).aiAutoDescription as string) : '';
  const aiDescFirstLine = aiDesc.trim().split('\n')[0]?.slice(0, 120) || '';
  const hasAi = aiTags.length > 0 || !!aiDesc.trim();

  return (
    <article
      ref={setCardEl}
      className={cn(
        'meme-card block w-full overflow-hidden rounded-xl cursor-pointer break-inside-avoid mb-3 relative isolate',
        'bg-white/60 dark:bg-white/5 ring-1 ring-black/5 dark:ring-white/10 shadow-sm',
        'will-change-transform',
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
      <div className="relative w-full bg-gray-900 z-0" style={{ aspectRatio }}>
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
            // NOTE: On hover the whole card is slightly scaled (see `src/index.css` .meme-card:hover).
            // That transform can create a 1px anti-aliased edge where the card background/ring peeks through.
            // Bleed the caption by 1px to fully cover the rounded edge on all DPRs.
            className="absolute -bottom-px -left-0.5 -right-0.5 bg-black/70 text-white p-2 text-center transition-opacity duration-200 z-20"
            aria-label={`Meme title: ${meme.title}`}
          >
            <p className="text-sm font-medium truncate px-2">{meme.title}</p>
          </div>
        )}

        {hasAi ? (
          <div className="absolute top-2 left-2 z-30 flex flex-col gap-1">
            {aiTags.length > 0 ? (
              <span className="inline-flex items-center rounded-full bg-black/65 text-white text-[11px] font-semibold px-2 py-0.5">
                AI tags: {aiTags.length}
              </span>
            ) : null}
            {aiDesc.trim() ? (
              <Tooltip delayMs={250} content={aiDescFirstLine || 'AI description'}>
                <span className="inline-flex items-center rounded-full bg-black/65 text-white text-[11px] font-semibold px-2 py-0.5">
                  AI desc
                </span>
              </Tooltip>
            ) : null}
          </div>
        ) : null}
      </div>
    </article>
  );
}


