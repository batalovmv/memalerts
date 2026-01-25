import { memo, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';

import type { Meme } from '@/types';

import { resolveMediaUrl } from '@/lib/urls';
import { isEffectivelyEmptyAiDescription } from '@/shared/lib/aiText';
import { cn } from '@/shared/lib/cn';
import { Spinner, Tooltip } from '@/shared/ui';

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
  onMediaError: () => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onClick: () => void;
  onMouseDown: () => void;
  onTouchStart: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  showAiBadges?: boolean;
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
  onMediaError,
  onMouseEnter,
  onMouseLeave,
  onClick,
  onMouseDown,
  onTouchStart,
  onKeyDown,
  showAiBadges = false,
}: MemeCardViewProps) {
  const { t } = useTranslation();
  const hasAiFields = 'aiAutoDescription' in meme || 'aiAutoTagNames' in meme || 'aiStatus' in meme || 'aiAutoTitle' in meme;
  const aiTags = Array.isArray(meme.aiAutoTagNames) ? meme.aiAutoTagNames.filter((x) => typeof x === 'string') : [];
  const aiDesc = typeof meme.aiAutoDescription === 'string' ? meme.aiAutoDescription : '';
  const aiStatus = typeof meme.aiStatus === 'string' ? meme.aiStatus : null;
  const aiStatusLabel = aiStatus === 'failed_final' ? 'failed' : aiStatus;
  const isAiProcessing = aiStatus === 'pending' || aiStatus === 'processing';
  const aiDescEffectivelyEmpty = isEffectivelyEmptyAiDescription(meme.aiAutoDescription, meme.title);
  const hasAiDesc = !!aiDesc.trim() && !aiDescEffectivelyEmpty;
  const aiDescFirstLine = hasAiDesc ? aiDesc.trim().split('\n')[0]?.slice(0, 120) || '' : '';
  const hasAi = aiTags.length > 0 || hasAiDesc;
  const qualityScore =
    typeof meme.qualityScore === 'number' && Number.isFinite(meme.qualityScore) ? meme.qualityScore : null;
  const qualityTier =
    qualityScore === null
      ? null
      : qualityScore >= 90
        ? { label: 'S', className: 'bg-emerald-500/90 text-white' }
        : qualityScore >= 80
          ? { label: 'A', className: 'bg-sky-500/90 text-white' }
          : qualityScore >= 65
            ? { label: 'B', className: 'bg-amber-400/95 text-black' }
            : { label: 'C', className: 'bg-slate-500/85 text-white' };
  const qualityLabel =
    qualityScore !== null
      ? t('memes.qualityScoreLabel', {
          defaultValue: 'Quality: {{score}}',
          score: Math.round(qualityScore),
        })
      : null;
  const basePrice =
    typeof meme.basePriceCoins === 'number' && Number.isFinite(meme.basePriceCoins)
      ? meme.basePriceCoins
      : meme.priceCoins;
  const dynamicPrice =
    typeof meme.dynamicPriceCoins === 'number' && Number.isFinite(meme.dynamicPriceCoins)
      ? meme.dynamicPriceCoins
      : null;
  const displayPrice =
    typeof dynamicPrice === 'number' && Number.isFinite(dynamicPrice) ? dynamicPrice : basePrice;
  const showPrice = Number.isFinite(displayPrice) && displayPrice > 0;
  const hasDynamicDiff =
    typeof dynamicPrice === 'number' &&
    Number.isFinite(dynamicPrice) &&
    Number.isFinite(basePrice) &&
    dynamicPrice !== basePrice;
  const trendDirection =
    meme.priceTrend && meme.priceTrend !== 'stable'
      ? meme.priceTrend
      : hasDynamicDiff
        ? dynamicPrice > basePrice
          ? 'rising'
          : 'falling'
        : null;
  const showTrend = trendDirection === 'rising' || trendDirection === 'falling';
  const trendIcon = trendDirection === 'rising' ? '↑' : trendDirection === 'falling' ? '↓' : null;
  const trendText =
    hasDynamicDiff && Number.isFinite(basePrice) && basePrice > 0
      ? Math.round(((dynamicPrice - basePrice) / basePrice) * 100)
      : null;
  const cooldownSeconds =
    typeof meme.cooldownSecondsRemaining === 'number' && Number.isFinite(meme.cooldownSecondsRemaining)
      ? Math.max(0, Math.floor(meme.cooldownSecondsRemaining))
      : 0;
  const isCooldownActive = cooldownSeconds > 0;
  const cooldownLabel = isCooldownActive
    ? (() => {
        const minutes = Math.floor(cooldownSeconds / 60);
        const seconds = cooldownSeconds % 60;
        return minutes > 0 ? `${minutes}:${String(seconds).padStart(2, '0')}` : `${seconds}s`;
      })()
    : null;
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
  const previewUrl = meme.previewUrl ? resolveMediaUrl(meme.previewUrl) : mediaUrl;

  const hasMedia = Boolean(previewUrl);

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
        {!shouldLoadMedia || !hasMedia ? (
          <div className="w-full h-full bg-gray-900" aria-hidden="true" />
        ) : meme.type === 'video' ? (
          <video
            ref={videoRef}
            src={previewUrl}
            onError={onMediaError}
            muted={videoMuted}
            autoPlay={previewMode === 'autoplayMuted'}
            loop
            playsInline
            className="w-full h-full object-contain"
            preload="metadata"
            aria-label={`Video preview: ${meme.title}`}
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
        {showAiBadges && isAiProcessing ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/30 backdrop-blur-[1px]">
            <div className="flex items-center gap-2 rounded-full bg-black/70 text-white text-xs font-semibold px-3 py-1.5 animate-pulse">
              <Spinner className="h-4 w-4 border-white/70 border-t-white" />
              <span>{t('submissions.aiProcessing', { defaultValue: 'AI: processing...' })}</span>
            </div>
          </div>
        ) : null}
        {isHovered && (
          <div
            // NOTE: On hover the whole card is slightly scaled (see `src/index.css` .meme-card:hover).
            // That transform can create a 1px anti-aliased edge where the card background/ring peeks through.
            // Bleed the caption by 1px to fully cover the rounded edge on all DPRs.
            className="absolute -bottom-px -left-0.5 -right-0.5 bg-black/70 text-white p-2 text-center transition-opacity duration-200 z-20"
            aria-label={`Meme title: ${meme.title}`}
          >
            <p className="text-sm font-medium truncate px-2 flex items-center justify-center gap-2">
              <span className="truncate">{meme.title}</span>
              {showAiBadges && isAiProcessing ? (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-white/90">
                  <Spinner className="h-3 w-3 border-white/60 border-t-white" />
                  <span>{t('submissions.aiProcessing', { defaultValue: 'AI: processing...' })}</span>
                </span>
              ) : null}
            </p>
          </div>
        )}

        {showAiBadges && (hasAi || hasAiFields) ? (
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
                {isAiProcessing
                  ? t('submissions.aiProcessing', { defaultValue: 'AI: processing...' })
                  : aiStatusLabel
                    ? `AI: ${aiStatusLabel}`
                    : 'AI: pending'}
              </span>
            ) : null}
          </div>
        ) : null}

        {qualityTier || activationsCount > 0 ? (
          <div className="absolute top-2 right-2 z-30 flex flex-col items-end gap-1">
            {qualityTier ? (
              <Tooltip delayMs={200} content={qualityLabel || 'Quality score'}>
                <span
                  className={cn(
                    'inline-flex items-center justify-center rounded-full text-[11px] font-semibold px-2 py-0.5 shadow-sm ring-1 ring-black/10',
                    qualityTier.className,
                  )}
                >
                  {qualityTier.label}
                </span>
              </Tooltip>
            ) : null}
            {activationsCount > 0 ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-black/70 text-white text-[11px] font-semibold px-2 py-0.5">
                <span>{activationsLabel}</span>
              </span>
            ) : null}
          </div>
        ) : null}

        {(showPrice || isCooldownActive) && (
          <div className="absolute bottom-2 left-2 z-30 flex flex-col gap-1">
            {showPrice ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-black/70 text-white text-[11px] font-semibold px-2 py-0.5">
                {hasDynamicDiff ? (
                  <span className="inline-flex items-center gap-1">
                    <span className="line-through text-white/60">{basePrice}</span>
                    <span>{displayPrice}</span>
                  </span>
                ) : (
                  <span>{displayPrice}</span>
                )}
                {showTrend ? (
                  <span
                    className={cn(
                      'ml-1 text-[10px]',
                      trendDirection === 'rising' && 'text-rose-200',
                      trendDirection === 'falling' && 'text-emerald-200',
                    )}
                  >
                    {trendIcon}
                    {typeof trendText === 'number' && trendText !== 0 ? `${trendText > 0 ? '+' : ''}${trendText}%` : ''}
                  </span>
                ) : null}
              </span>
            ) : null}
            {isCooldownActive && cooldownLabel ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-black/70 text-white text-[11px] font-semibold px-2 py-0.5">
                <span>{t('memes.cooldownLabel', { defaultValue: 'Cooldown {{time}}', time: cooldownLabel })}</span>
              </span>
            ) : null}
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
    prev.videoMuted === next.videoMuted &&
    prev.showAiBadges === next.showAiBadges
  );
});
