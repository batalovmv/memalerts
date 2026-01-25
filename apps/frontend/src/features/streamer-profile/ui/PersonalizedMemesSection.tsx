import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { Meme } from '@/types';

import { resolveMediaUrl } from '@/lib/urls';
import { cn } from '@/shared/lib/cn';
import { getMemePrimaryId } from '@/shared/lib/memeIds';

type PersonalizedMemesSectionProps = {
  memes: Meme[];
  loading: boolean;
  profileReady: boolean;
  totalActivations: number;
  mode: 'personalized' | 'fallback';
  autoplayMemesEnabled: boolean;
  onSelectMeme: (meme: Meme) => void;
  showAll?: boolean;
  onShowAll?: () => void;
  onHideAll?: () => void;
};

const MIN_ACTIVATIONS = 5;
const DEFAULT_SCROLL_STEP = 320;

function PersonalizedMemeTile({
  meme,
  autoplay,
  onSelect,
}: {
  meme: Meme;
  autoplay: boolean;
  onSelect: (meme: Meme) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const previewUrl = meme.previewUrl ? resolveMediaUrl(meme.previewUrl) : resolveMediaUrl(meme.fileUrl);
  const hasVideo = meme.type === 'video' && Boolean(previewUrl);

  return (
    <button
      type="button"
      onClick={() => onSelect(meme)}
      onMouseEnter={() => {
        if (!autoplay) {
          void videoRef.current?.play();
        }
      }}
      onMouseLeave={() => {
        if (!autoplay && videoRef.current) {
          videoRef.current.pause();
          videoRef.current.currentTime = 0;
        }
      }}
      className={cn(
        'group/tile relative shrink-0 w-64 sm:w-72 text-left',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
      )}
      aria-label={`Open meme: ${meme.title}`}
    >
      <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-black/80 shadow-[0_18px_40px_rgba(0,0,0,0.35)]">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.2),transparent_55%)]" />
        <div className="absolute inset-0 bg-gradient-to-br from-white/10 via-transparent to-black/60" />
        <div className="relative w-full aspect-video">
          {hasVideo ? (
            <video
              ref={videoRef}
              src={previewUrl}
              muted
              loop
              playsInline
              autoPlay={autoplay}
              preload="metadata"
              className="absolute inset-0 h-full w-full object-cover"
              aria-label={`Video preview: ${meme.title}`}
            />
          ) : (
            <div className="absolute inset-0 bg-gray-900" aria-hidden="true" />
          )}
        </div>
        <div className="absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/85 via-black/40 to-transparent p-3">
          <div className="text-sm font-semibold text-white truncate">{meme.title}</div>
        </div>
      </div>
    </button>
  );
}

export function PersonalizedMemesSection({
  memes,
  loading,
  profileReady,
  totalActivations,
  mode,
  autoplayMemesEnabled,
  onSelectMeme,
  showAll = false,
  onShowAll,
  onHideAll,
}: PersonalizedMemesSectionProps) {
  const { t } = useTranslation();
  const remaining = useMemo(() => Math.max(0, MIN_ACTIVATIONS - totalActivations), [totalActivations]);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const hint = profileReady
    ? t('profile.forYouHint', { defaultValue: 'Personal picks based on your activations.' })
    : t('profile.forYouHintLocked', {
        defaultValue: 'Make {{count}} more activations to unlock personalization.',
        count: remaining,
      });

  useEffect(() => {
    if (showAll) {
      setCanScrollRight(false);
      return;
    }

    const el = scrollerRef.current;
    if (!el) return;

    const update = () => {
      const maxScroll = el.scrollWidth - el.clientWidth;
      setCanScrollRight(maxScroll > 8 && el.scrollLeft < maxScroll - 8);
    };

    update();
    el.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);

    return () => {
      el.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [memes.length, showAll]);

  return (
    <section className="mt-6 group/for-you">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2 mb-3">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
            {t('profile.forYouTitle', { defaultValue: 'For you' })}
          </h2>
          <p className="text-sm text-gray-600 dark:text-gray-300">{hint}</p>
        </div>
        <div className="flex items-center gap-3">
          {mode === 'fallback' && !profileReady ? (
            <div className="text-xs text-gray-500 dark:text-gray-400">
              {t('profile.forYouFallback', { defaultValue: 'Showing fresh memes while we learn your taste.' })}
            </div>
          ) : null}
          {onShowAll && !showAll ? (
            <button
              type="button"
              onClick={onShowAll}
              className={cn(
                'text-xs font-semibold text-primary/80 hover:text-primary transition-opacity',
                'opacity-0 pointer-events-none group-hover/for-you:opacity-100 group-hover/for-you:pointer-events-auto',
                'focus-visible:opacity-100 focus-visible:pointer-events-auto',
              )}
            >
              {t('common.seeAll', { defaultValue: 'See all' })}
            </button>
          ) : onHideAll && showAll ? (
            <button
              type="button"
              onClick={onHideAll}
              className={cn(
                'text-xs font-semibold text-gray-700 dark:text-gray-200 hover:text-primary transition-colors',
                'opacity-100',
              )}
            >
              {t('common.hide', { defaultValue: 'Hide' })}
            </button>
          ) : null}
        </div>
      </div>

      {loading ? (
        <div className="flex gap-3 overflow-x-auto pb-2 no-scrollbar">
          {[...Array(4)].map((_, i) => (
            <div
              key={i}
              className="w-64 sm:w-72 shrink-0 rounded-2xl bg-gray-200/80 dark:bg-gray-700/60 animate-pulse aspect-video"
            />
          ))}
        </div>
      ) : memes.length === 0 ? (
        <div className="surface p-4 text-sm text-gray-600 dark:text-gray-300">
          {t('profile.forYouEmpty', { defaultValue: 'No picks yet. Try activating a few memes.' })}
        </div>
      ) : showAll ? (
        <div className="rounded-2xl border border-white/10 bg-white/40 dark:bg-white/5 shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div>
              <div className="text-xs uppercase tracking-[0.24em] text-gray-500 dark:text-gray-400">
                {t('profile.forYouTitle', { defaultValue: 'For you' })}
              </div>
              <div className="text-sm text-gray-600 dark:text-gray-300">
                {t('profile.forYouHint', { defaultValue: 'Personal picks based on your activations.' })}
              </div>
            </div>
            {onHideAll ? (
              <button
                type="button"
                onClick={onHideAll}
                className="inline-flex items-center gap-2 rounded-full border border-black/10 dark:border-white/10 px-3 py-1.5 text-xs font-semibold text-gray-700 dark:text-gray-200 hover:border-primary/40 hover:text-primary transition-colors"
              >
                {t('common.hide', { defaultValue: 'Hide' })}
              </button>
            ) : null}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {memes.map((meme) => (
              <PersonalizedMemeTile
                key={getMemePrimaryId(meme)}
                meme={meme}
                autoplay={autoplayMemesEnabled}
                onSelect={onSelectMeme}
              />
            ))}
          </div>
        </div>
      ) : (
        <div className="relative">
          <div
            ref={scrollerRef}
            className={cn(
              'no-scrollbar flex gap-4 overflow-x-auto pb-4 pt-2 px-2 snap-x scroll-smooth',
              'rounded-2xl border border-white/10 bg-white/30 dark:bg-white/5',
              'shadow-[inset_0_1px_0_rgba(255,255,255,0.15)]',
            )}
          >
            {memes.map((meme) => (
              <div key={getMemePrimaryId(meme)} className="snap-start">
                <PersonalizedMemeTile
                  meme={meme}
                  autoplay={autoplayMemesEnabled}
                  onSelect={onSelectMeme}
                />
              </div>
            ))}
          </div>

          <div
            className={cn(
              'pointer-events-none absolute inset-y-0 right-0 w-16',
              'bg-gradient-to-l from-white/80 via-white/40 to-transparent',
              'dark:from-gray-950/80 dark:via-gray-950/40',
              'opacity-0 group-hover/for-you:opacity-100 transition-opacity',
            )}
            aria-hidden="true"
          />
          <button
            type="button"
            onClick={() => scrollerRef.current?.scrollBy({ left: DEFAULT_SCROLL_STEP, behavior: 'smooth' })}
            className={cn(
              'absolute right-2 top-1/2 -translate-y-1/2',
              'h-10 w-10 rounded-full bg-black/60 text-white flex items-center justify-center',
              'shadow-lg ring-1 ring-white/20 transition',
              'opacity-0 pointer-events-none group-hover/for-you:opacity-100 group-hover/for-you:pointer-events-auto',
              'focus-visible:opacity-100 focus-visible:pointer-events-auto',
              !canScrollRight && 'opacity-0 pointer-events-none',
            )}
            aria-label={t('common.loadMore', { defaultValue: 'Load more' })}
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      )}
    </section>
  );
}
