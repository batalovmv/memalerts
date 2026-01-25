import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { Meme } from '@/types';
import type { MutableRefObject } from 'react';

import { getMemePrimaryId } from '@/shared/lib/memeIds';
import { cn } from '@/shared/lib/cn';
import { Spinner } from '@/shared/ui';
import MemeCard from '@/widgets/meme-card/MemeCard';

type StreamerProfileMemesSectionProps = {
  memes: Meme[];
  searchResults: Meme[];
  searchQuery: string;
  tagFilter: string;
  listMode: 'all' | 'favorites' | 'frequent' | 'recent' | 'hidden' | 'trending' | 'blocked' | 'forYou';
  onChangeListMode: (
    next: 'all' | 'favorites' | 'frequent' | 'recent' | 'hidden' | 'trending' | 'blocked' | 'forYou',
  ) => void;
  trendingScope: 'channel' | 'global';
  trendingPeriod: 7 | 30;
  onChangeTrendingScope: (next: 'channel' | 'global') => void;
  onChangeTrendingPeriod: (next: 7 | 30) => void;
  isAuthed: boolean;
  onRequireAuth: () => void;
  isSearching: boolean;
  memesLoading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  loadMoreRef: MutableRefObject<HTMLDivElement | null>;
  autoplayMemesEnabled: boolean;
  isOwner: boolean;
  hasAiProcessing: boolean;
  personalizedMemes: Meme[];
  personalizedLoading: boolean;
  personalizedProfileReady: boolean;
  personalizedTotalActivations: number;
  personalizedMode: 'personalized' | 'fallback';
  onSelectMeme: (meme: Meme) => void;
};

const MIN_ACTIVATIONS = 5;

type MemeCardItemProps = {
  meme: Meme;
  previewMode: 'hoverMuted' | 'autoplayMuted';
  isOwner: boolean;
  onSelectMeme: (meme: Meme) => void;
};

const MemeCardItem = memo(
  function MemeCardItem({ meme, previewMode, isOwner, onSelectMeme }: MemeCardItemProps) {
    const handleClick = useCallback(() => onSelectMeme(meme), [meme, onSelectMeme]);

    return (
      <MemeCard
        meme={meme}
        onClick={handleClick}
        isOwner={isOwner}
        previewMode={previewMode}
        showAiBadges={false}
      />
    );
  },
  (prev, next) =>
    prev.meme === next.meme &&
    prev.previewMode === next.previewMode &&
    prev.isOwner === next.isOwner &&
    prev.onSelectMeme === next.onSelectMeme,
);

export function StreamerProfileMemesSection({
  memes,
  searchResults,
  searchQuery,
  tagFilter,
  listMode,
  onChangeListMode,
  trendingScope,
  trendingPeriod,
  onChangeTrendingScope,
  onChangeTrendingPeriod,
  isAuthed,
  onRequireAuth,
  isSearching,
  memesLoading,
  loadingMore,
  hasMore,
  loadMoreRef,
  autoplayMemesEnabled,
  isOwner,
  hasAiProcessing,
  personalizedMemes,
  personalizedLoading,
  personalizedProfileReady,
  personalizedTotalActivations,
  personalizedMode,
  onSelectMeme,
}: StreamerProfileMemesSectionProps) {
  const { t } = useTranslation();
  const isForYou = listMode === 'forYou';
  const isTrending = listMode === 'trending';
  const hasSearch = searchQuery.trim().length > 0 || tagFilter.trim().length > 0;
  const showSearchResults = !isForYou && hasSearch;
  const memesToDisplay = isForYou ? personalizedMemes : showSearchResults ? searchResults : memes;
  const remaining = Math.max(0, MIN_ACTIVATIONS - personalizedTotalActivations);
  const forYouHint = personalizedProfileReady
    ? t('profile.forYouHint', { defaultValue: 'Personal picks based on your activations.' })
    : t('profile.forYouHintLocked', {
        defaultValue: 'Make {{count}} more activations to unlock personalization.',
        count: remaining,
      });
  const previewMode = autoplayMemesEnabled ? 'autoplayMuted' : 'hoverMuted';
  const cardNodes = useMemo(
    () =>
      memesToDisplay.map((meme) => (
        <MemeCardItem
          key={getMemePrimaryId(meme)}
          meme={meme}
          onSelectMeme={onSelectMeme}
          previewMode={previewMode}
          isOwner={isOwner}
        />
      )),
    [isOwner, memesToDisplay, onSelectMeme, previewMode],
  );

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h2 className="text-2xl font-bold dark:text-white">{t('profile.availableMemes')}</h2>
        <div
          role="tablist"
          aria-label={t('profile.availableMemes', { defaultValue: 'Available memes' })}
          className={cn(
            'flex flex-wrap items-center gap-1 rounded-full border border-gray-200/70 dark:border-white/10',
            'bg-white/70 dark:bg-gray-900/50 p-1 shadow-sm',
          )}
        >
          {(
            [
              {
                value: 'forYou',
                label: t('profile.filters.forYou', {
                  defaultValue: t('profile.forYouTitle', { defaultValue: 'For you' }),
                }),
                requiresAuth: true,
              },
              { value: 'all', label: t('profile.filters.all', { defaultValue: 'All' }), requiresAuth: false },
              {
                value: 'favorites',
                label: t('profile.filters.favorites', {
                  defaultValue: t('search.myFavorites', { defaultValue: 'Favorites' }),
                }),
                requiresAuth: true,
              },
            ] as Array<{ value: StreamerProfileMemesSectionProps['listMode']; label: string; requiresAuth: boolean }>
          ).map((option) => {
            const isActive = listMode === option.value;
            const isDisabled = option.requiresAuth && !isAuthed;
            return (
              <button
                key={option.value}
                type="button"
                role="tab"
                aria-selected={isActive}
                aria-disabled={isDisabled}
                onClick={() => {
                  if (isDisabled) {
                    onRequireAuth();
                    return;
                  }
                  onChangeListMode(option.value);
                }}
                className={cn(
                  'px-3 py-1.5 text-xs font-semibold rounded-full transition-colors',
                  isActive
                    ? 'bg-primary text-white shadow-[0_6px_14px_rgba(10,132,255,0.25)]'
                    : 'text-gray-700 dark:text-gray-200 hover:bg-white/80 dark:hover:bg-white/10',
                  isDisabled && 'opacity-60',
                )}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>

      {isTrending ? (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div
            className={cn(
              'inline-flex items-center gap-1 rounded-full border border-gray-200/70 dark:border-white/10',
              'bg-white/70 dark:bg-gray-900/50 p-1 shadow-sm',
            )}
          >
            {([
              { value: 'channel', label: t('profile.trendingScope.channel', { defaultValue: 'Channel' }) },
              { value: 'global', label: t('profile.trendingScope.global', { defaultValue: 'Global' }) },
            ] as const).map((option) => {
              const isActive = trendingScope === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => onChangeTrendingScope(option.value)}
                  className={cn(
                    'px-3 py-1.5 text-xs font-semibold rounded-full transition-colors',
                    isActive
                      ? 'bg-primary text-white shadow-[0_6px_14px_rgba(10,132,255,0.25)]'
                      : 'text-gray-700 dark:text-gray-200 hover:bg-white/80 dark:hover:bg-white/10',
                  )}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
          <div
            className={cn(
              'inline-flex items-center gap-1 rounded-full border border-gray-200/70 dark:border-white/10',
              'bg-white/70 dark:bg-gray-900/50 p-1 shadow-sm',
            )}
          >
            {([
              { value: 7, label: t('profile.trendingPeriod.week', { defaultValue: '7 days' }) },
              { value: 30, label: t('profile.trendingPeriod.month', { defaultValue: '30 days' }) },
            ] as const).map((option) => {
              const isActive = trendingPeriod === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => onChangeTrendingPeriod(option.value)}
                  className={cn(
                    'px-3 py-1.5 text-xs font-semibold rounded-full transition-colors',
                    isActive
                      ? 'bg-primary text-white shadow-[0_6px_14px_rgba(10,132,255,0.25)]'
                      : 'text-gray-700 dark:text-gray-200 hover:bg-white/80 dark:hover:bg-white/10',
                  )}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {isForYou ? (
        <div className="mb-4 rounded-xl border border-white/10 bg-white/60 dark:bg-white/5 p-3 flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm text-gray-600 dark:text-gray-300">{forYouHint}</div>
          {personalizedMode === 'fallback' && !personalizedProfileReady ? (
            <div className="text-xs text-gray-500 dark:text-gray-400">
              {t('profile.forYouFallback', { defaultValue: 'Showing fresh memes while we learn your taste.' })}
            </div>
          ) : null}
        </div>
      ) : null}

      {listMode === 'all' && isOwner && hasAiProcessing ? (
        <div className="mb-4 rounded-xl bg-amber-50/80 dark:bg-amber-400/10 border border-amber-200/70 dark:border-amber-400/30 p-3 flex items-center gap-3">
          <Spinner className="h-4 w-4 border-amber-300/70 border-t-amber-500" />
          <div className="text-sm text-amber-900 dark:text-amber-200">
            {t('profile.aiProcessingNotice', {
              defaultValue: 'AI is processing new memes. They will appear automatically.',
            })}
          </div>
        </div>
      ) : null}
      {(() => {
        if (isForYou) {
          if (personalizedLoading) {
            return (
              <div className="columns-2 md:columns-3 lg:columns-4 xl:columns-5 gap-0" style={{ columnGap: 0 }}>
                {[...Array(6)].map((_, i) => (
                  <div key={i} className="mb-2 bg-gray-200 dark:bg-gray-700 rounded animate-pulse aspect-video" />
                ))}
              </div>
            );
          }

          if (memesToDisplay.length === 0) {
            return (
              <div className="surface p-6 text-center">
                <div className="text-base font-semibold text-gray-900 dark:text-white">
                  {t('profile.forYouEmpty', { defaultValue: 'No picks yet. Try activating a few memes.' })}
                </div>
                <div className="mt-2 text-sm text-gray-600 dark:text-gray-400">{forYouHint}</div>
              </div>
            );
          }
        } else if (memesLoading && !hasSearch && !isForYou && memesToDisplay.length === 0) {
          return (
            <div className="columns-2 md:columns-3 lg:columns-4 xl:columns-5 gap-0" style={{ columnGap: 0 }}>
              {[...Array(6)].map((_, i) => (
                <div key={i} className="mb-2 bg-gray-200 dark:bg-gray-700 rounded animate-pulse aspect-video" />
              ))}
            </div>
          );
        } else if (showSearchResults && isSearching && memesToDisplay.length === 0) {
          return (
            <div className="flex items-center justify-center gap-3 py-6 text-gray-600 dark:text-gray-300">
              <Spinner className="h-5 w-5" />
              <span>{t('search.searching', { defaultValue: 'Searching...' })}</span>
            </div>
          );
        }

        if (memesToDisplay.length === 0 && !memesLoading) {
          return (
            <div className="surface p-6 text-center">
              <div className="text-base font-semibold text-gray-900 dark:text-white">
                {hasSearch
                  ? t('search.noResults', { defaultValue: 'No memes found matching your criteria' })
                  : t('profile.noMemes', { defaultValue: 'No memes yet' })}
              </div>
              {hasSearch && (
                <div className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                  {t('search.tryAdjusting', { defaultValue: 'Try changing filters or removing some tags.' })}
                </div>
              )}
            </div>
          );
        }

        return (
          <>
            <div className="meme-masonry">
              {cardNodes}
            </div>
            {/* Infinite scroll trigger and loading indicator */}
            {!isForYou && !hasSearch && (
              <div ref={loadMoreRef} className="mt-4">
                {loadingMore && (
                  <div className="flex items-center justify-center gap-3 py-4 text-gray-600 dark:text-gray-300">
                    <Spinner className="h-5 w-5" />
                    <span>{t('common.loading', { defaultValue: 'Loading…' })}</span>
                  </div>
                )}
                {!hasMore && memes.length > 0 && (
                  <div className="text-center py-4 text-gray-500 dark:text-gray-400">
                    {t('profile.allMemesLoaded', { defaultValue: 'All memes loaded' })}
                  </div>
                )}
              </div>
            )}
          </>
        );
      })()}
    </>
  );
}
