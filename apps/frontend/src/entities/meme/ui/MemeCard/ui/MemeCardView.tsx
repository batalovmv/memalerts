import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { Meme } from '@/types';
import type { RefObject } from 'react';

import { cn } from '@/shared/lib/cn';
import { Tooltip } from '@/shared/ui';
import { useAppSelector } from '@/store/hooks';

import { AiRegenerateButton } from '../../AiRegenerateButton';

export type MemeCardViewProps = {
  meme: Meme;
  mediaUrl: string;
  previewMode: 'hoverWithSound' | 'hoverMuted' | 'autoplayMuted';
  aspectRatio: number;
  isHovered: boolean;
  shouldLoadMedia: boolean;
  videoMuted: boolean;
  showAiAnalysis?: boolean;
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
  showAiAnalysis,
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
  const [aiOpen, setAiOpen] = useState(false);
  const { user } = useAppSelector((s) => s.auth);

  const hasAiFields = 'aiAutoDescription' in meme || 'aiAutoTagNames' in meme;
  const aiTags = Array.isArray(meme.aiAutoTagNames) ? meme.aiAutoTagNames.filter((x) => typeof x === 'string') : [];
  const aiDesc = typeof meme.aiAutoDescription === 'string' ? meme.aiAutoDescription : '';
  const aiDescFirstLine = aiDesc.trim().split('\n')[0]?.slice(0, 120) || '';
  const hasAi = aiTags.length > 0 || !!aiDesc.trim();

  const canRegenerateAi =
    !!user &&
    (user.role === 'admin' || (user.role === 'streamer' && !!user.channelId && !!meme.channelId && user.channelId === meme.channelId));

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

        {hasAi || hasAiFields ? (
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
            ) : hasAiFields ? (
              <span className="inline-flex items-center rounded-full bg-black/65 text-white text-[11px] font-semibold px-2 py-0.5">
                AI: pending
              </span>
            ) : null}
          </div>
        ) : null}
      </div>

      {showAiAnalysis && (hasAi || hasAiFields) ? (
        <div className="px-3 py-3 border-t border-black/5 dark:border-white/10">
          <button
            type="button"
            className="text-xs font-semibold text-gray-700 dark:text-gray-200 hover:underline"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setAiOpen((v) => !v);
            }}
            onMouseDown={(e) => {
              // Prevent card click audio-unmute handler from triggering when toggling AI.
              e.preventDefault();
              e.stopPropagation();
            }}
            onTouchStart={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            aria-expanded={aiOpen}
          >
            {aiOpen
              ? t('submissions.aiHide', { defaultValue: 'Скрыть AI анализ' })
              : t('submissions.aiShow', { defaultValue: 'Показать AI анализ' })}
          </button>

          {aiOpen ? (
            <div className="mt-2 rounded-lg bg-black/5 dark:bg-white/5 p-3 text-sm text-gray-800 dark:text-gray-200">
              {!hasAi ? (
                <div className="text-xs text-gray-700 dark:text-gray-300">
                  {t('submissions.aiNoDataYet', { defaultValue: 'AI: данных пока нет (в обработке). Обнови через 30–60с.' })}
                  <div className="mt-2">
                    <AiRegenerateButton meme={meme} show={canRegenerateAi} />
                  </div>
                </div>
              ) : null}

              {aiDesc.trim() ? (
                <div className="mt-2">
                  <div className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                    {t('submissions.aiAutoDescription', { defaultValue: 'AI описание' })}
                  </div>
                  <div className="mt-1 text-sm text-gray-700 dark:text-gray-200 whitespace-pre-wrap">{aiDesc}</div>
                </div>
              ) : null}

              {aiTags.length > 0 ? (
                <div className="mt-2">
                  <div className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                    {t('submissions.aiAutoTags', { defaultValue: 'AI теги' })}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {aiTags.slice(0, 20).map((tag) => (
                      <span
                        key={tag}
                        className="inline-flex items-center rounded-full bg-primary/15 text-primary-700 dark:text-primary-200 ring-1 ring-primary/20 text-[11px] font-semibold px-2 py-0.5"
                      >
                        {tag}
                      </span>
                    ))}
                    {aiTags.length > 20 ? (
                      <span className="inline-flex items-center rounded-full bg-black/5 dark:bg-white/10 text-gray-700 dark:text-gray-200 ring-1 ring-black/10 dark:ring-white/10 text-[11px] font-semibold px-2 py-0.5">
                        +{aiTags.length - 20}
                      </span>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}


