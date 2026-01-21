import { memo, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';

import type { Meme } from '@/types';

import { isEffectivelyEmptyAiDescription } from '@/shared/lib/aiText';
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
  onMouseEnter,
  onMouseLeave,
  onClick,
  onMouseDown,
  onTouchStart,
  onKeyDown,
}: MemeCardViewProps) {
  const { t } = useTranslation();
  const hasAiFields = 'aiAutoDescription' in meme || 'aiAutoTagNames' in meme;
  const aiTags = Array.isArray(meme.aiAutoTagNames) ? meme.aiAutoTagNames.filter((x) => typeof x === 'string') : [];
  const aiDesc = typeof meme.aiAutoDescription === 'string' ? meme.aiAutoDescription : '';
  const aiDescEffectivelyEmpty = isEffectivelyEmptyAiDescription(meme.aiAutoDescription, meme.title);
  const hasAiDesc = !!aiDesc.trim() && !aiDescEffectivelyEmpty;
  const aiDescFirstLine = hasAiDesc ? aiDesc.trim().split('\n')[0]?.slice(0, 120) || '' : '';
  const hasAi = aiTags.length > 0 || hasAiDesc;
  const activationsCount =
    typeof meme.activationsCount === 'number' && Number.isFinite(meme.activationsCount)
      ? meme.activationsCount
      : typeof meme._count?.activations === 'number' && Number.isFinite(meme._count.activations)
        ? meme._count.activations
        : 0;
  const isPopular = activationsCount >= 100;
  const activationsLabel = t('memes.activationCountLabel', {
    defaultValue: '{{count}} activations',
    count: activationsCount,
  });

  return (
    <article
      ref={setCardEl}
      className={cn(
        'meme-card block w-full overflow-hidden rounded-xl cursor-pointer break-inside-avoid mb-3 relative isolate',
        'bg-white/60 dark:bg-white/5 ring-1 ring-black/5 dark:ring-white/10 shadow-sm',
        'will-change-transform',
        'focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent',
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

        {hasAi || hasAiFields ? (
          <div className="absolute top-2 left-2 z-30 flex flex-col gap-1">
            {aiTags.length > 0 ? (
              <span className="inline-flex items-center rounded-full bg-black/65 text-white text-[11px] font-semibold px-2 py-0.5">
                AI tags: {aiTags.length}
              </span>
            ) : null}
            {hasAiDesc ? (
              <Tooltip delayMs={250} content={aiDescFirstLine || 'AI description'}>
                <span className="inline-flex items-center rounded-full bg-black/65 text-white text-[11px] font-semibold px-2 py-0.5">
                  AI desc
                </span>
              </Tooltip>
            ) : hasAiFields ? (
              <span className="inline-flex items-center rounded-full bg-black/65 text-white text-[11px] font-semibold px-2 py-0.5">
                AI: pending
              </span>
            ) : null}
          </div>
        ) : null}

        {activationsCount > 0 ? (
          <div className="absolute top-2 right-2 z-30">
            <span className="inline-flex items-center gap-1 rounded-full bg-black/70 text-white text-[11px] font-semibold px-2 py-0.5">
              <span aria-hidden="true">🔥</span>
              <span>{activationsLabel}</span>
            </span>
          </div>
        ) : null}
      </div>
    </article>
  );
}

export const MemeCardView = memo(MemeCardViewBase, (prev, next) => {
  return (
    prev.meme.id === next.meme.id &&
    prev.aspectRatio === next.aspectRatio &&
    prev.isHovered === next.isHovered &&
    prev.shouldLoadMedia === next.shouldLoadMedia &&
    prev.videoMuted === next.videoMuted
  );
});
