import { useTranslation } from 'react-i18next';

import type { Meme } from '@/types';
import type { MutableRefObject } from 'react';

import { getMemePrimaryId } from '@/shared/lib/memeIds';
import { Spinner } from '@/shared/ui';
import MemeCard from '@/widgets/meme-card/MemeCard';

type StreamerProfileMemesSectionProps = {
  memes: Meme[];
  searchResults: Meme[];
  searchQuery: string;
  myFavorites: boolean;
  memesLoading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  loadMoreRef: MutableRefObject<HTMLDivElement | null>;
  autoplayMemesEnabled: boolean;
  isOwner: boolean;
  hasAiProcessing: boolean;
  onSelectMeme: (meme: Meme) => void;
};

export function StreamerProfileMemesSection({
  memes,
  searchResults,
  searchQuery,
  myFavorites,
  memesLoading,
  loadingMore,
  hasMore,
  loadMoreRef,
  autoplayMemesEnabled,
  isOwner,
  hasAiProcessing,
  onSelectMeme,
}: StreamerProfileMemesSectionProps) {
  const { t } = useTranslation();
  const memesToDisplay = myFavorites || searchQuery.trim() ? searchResults : memes;

  return (
    <>
      <h2 className="text-2xl font-bold mb-4 dark:text-white">{t('profile.availableMemes')}</h2>
      {isOwner && hasAiProcessing ? (
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
        if (memesLoading && !searchQuery.trim()) {
          return (
            <div className="columns-2 md:columns-3 lg:columns-4 xl:columns-5 gap-0" style={{ columnGap: 0 }}>
              {[...Array(6)].map((_, i) => (
                <div key={i} className="mb-2 bg-gray-200 dark:bg-gray-700 rounded animate-pulse aspect-video" />
              ))}
            </div>
          );
        }

        if (memesToDisplay.length === 0 && !memesLoading) {
          return (
            <div className="surface p-6 text-center">
              <div className="text-base font-semibold text-gray-900 dark:text-white">
                {searchQuery.trim()
                  ? t('search.noResults', { defaultValue: 'No memes found matching your criteria' })
                  : t('profile.noMemes', { defaultValue: 'No memes yet' })}
              </div>
              {searchQuery.trim() && (
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
              {memesToDisplay.map((meme) => (
                <MemeCard
                  key={getMemePrimaryId(meme)}
                  meme={meme}
                  onClick={() => onSelectMeme(meme)}
                  isOwner={isOwner}
                  previewMode={autoplayMemesEnabled ? 'autoplayMuted' : 'hoverMuted'}
                />
              ))}
            </div>
            {/* Infinite scroll trigger and loading indicator */}
            {!searchQuery.trim() && (
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
