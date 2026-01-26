import { memo, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/shared/lib/cn';

import type { MemeCardItem } from '../model/types';

export interface MemeCardViewProps {
  meme: MemeCardItem;
  mediaUrl: string;
  previewMode: 'hoverWithSound' | 'hoverMuted' | 'autoplayMuted';
  aspectRatio: number;
  isHovered: boolean;
  shouldLoadMedia: boolean;
  videoMuted: boolean;
  setCardEl: (node: HTMLElement | null) => void;
  videoRef: RefObject<HTMLVideoElement>;
  onMediaError: () => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onClick: () => void;
  onMouseDown: () => void;
  onTouchStart: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
}

function MemeCardViewBase({
  meme,
  mediaUrl,
  previewMode,
  aspectRatio,
  isHovered,
  shouldLoadMedia,
  videoMuted,
  setCardEl,
  videoRef,
  onMediaError,
  onMouseEnter,
  onMouseLeave,
  onClick,
  onMouseDown,
  onTouchStart,
  onKeyDown,
}: MemeCardViewProps) {
  const { t } = useTranslation();
  const activationsCount =
    typeof meme.activationsCount === 'number' && Number.isFinite(meme.activationsCount)
      ? meme.activationsCount
      : 0;
  const isPopular = activationsCount >= 100;
  const hasMedia = Boolean(mediaUrl);
  const coinsLabel = t('profile.coins', { defaultValue: 'coins' });
  const activationsLabel = t('memes.activationCountLabel', {
    defaultValue: '{{count}} plays',
    count: activationsCount,
  });
  const priceCoins = Number.isFinite(meme.priceCoins) ? meme.priceCoins : 0;

  return (
    <article
      ref={setCardEl}
      className={cn(
        'meme-card block w-full overflow-hidden rounded-xl cursor-pointer break-inside-avoid mb-3 relative isolate',
        'bg-white/60 dark:bg-white/5 ring-1 ring-black/5 dark:ring-white/10 shadow-sm',
        'will-change-transform',
        'focus-visible:ring-2 focus-visible:ring-primary/40',
        isPopular && 'ring-2 ring-orange-500/70',
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
        {!shouldLoadMedia || !hasMedia ? (
          <div className="w-full h-full bg-gray-900" aria-hidden="true" />
        ) : meme.type === 'video' ? (
          <video
            ref={videoRef}
            src={mediaUrl}
            onError={onMediaError}
            muted={videoMuted}
            autoPlay={previewMode === 'autoplayMuted'}
            loop
            playsInline
            className="w-full h-full object-contain"
            preload="metadata"
          />
        ) : (
          <img
            src={mediaUrl}
            alt={meme.title}
            className="w-full h-full object-contain"
            loading="lazy"
            onError={onMediaError}
          />
        )}

        {isHovered && (
          <div className="absolute -bottom-px -left-0.5 -right-0.5 bg-black/70 text-white p-2 text-center z-20">
            <p className="text-sm font-medium truncate px-2">
              {meme.title}
            </p>
          </div>
        )}

        {activationsCount > 0 && (
          <div className="absolute top-2 right-2 z-30">
            <span className="inline-flex items-center rounded-full bg-black/70 text-white text-[11px] font-semibold px-2 py-0.5">
              {activationsLabel}
            </span>
          </div>
        )}

        {priceCoins > 0 && (
          <div className="absolute bottom-2 left-2 z-30">
            <span className="inline-flex items-center rounded-full bg-black/70 text-white text-[11px] font-semibold px-2 py-0.5">
              {priceCoins} {coinsLabel}
            </span>
          </div>
        )}
      </div>
    </article>
  );
}

export const MemeCardView = memo(MemeCardViewBase, (prev, next) => {
  return (
    prev.meme === next.meme &&
    prev.mediaUrl === next.mediaUrl &&
    prev.previewMode === next.previewMode &&
    prev.aspectRatio === next.aspectRatio &&
    prev.isHovered === next.isHovered &&
    prev.shouldLoadMedia === next.shouldLoadMedia &&
    prev.videoMuted === next.videoMuted
  );
});
