import { useTranslation } from 'react-i18next';

import type { Meme } from '@/types';

import { getMemePrimaryId } from '@/shared/lib/memeIds';
import { Button, HelpTooltip, Spinner } from '@/shared/ui';
import MemeCard from '@/widgets/meme-card/MemeCard';

const skeletonAspectRatios = [1, 4 / 5, 16 / 9, 3 / 4, 1.2, 9 / 16, 5 / 4, 2 / 3] as const;

export type AllMemesGridProps = {
  memes: Meme[];
  loading: boolean;
  loadingMore: boolean;
  error?: string | null;
  onRetry?: () => void;
  loadMoreRef: React.RefObject<HTMLDivElement>;
  autoplayPreview: 'autoplayMuted' | 'hoverWithSound';
  onSelectMeme: (meme: Meme) => void;
};

export function AllMemesGrid({
  memes,
  loading,
  loadingMore,
  error,
  onRetry,
  loadMoreRef,
  autoplayPreview,
  onSelectMeme,
}: AllMemesGridProps) {
  const { t } = useTranslation();

  if (loading && memes.length === 0) {
    return (
      <div className="meme-masonry" aria-label={t('common.loading', { defaultValue: 'Loading…' })}>
        {Array.from({ length: 10 }).map((_, i) => {
          const aspectRatio = skeletonAspectRatios[i % skeletonAspectRatios.length];

          return (
            <div
              key={i}
              className="surface overflow-hidden rounded-xl break-inside-avoid mb-3 animate-pulse"
            >
              <div
                className="w-full bg-gray-200/70 dark:bg-white/10"
                style={{ aspectRatio }}
                aria-hidden="true"
              />
              <div className="px-3 py-3">
                <div className="h-3 w-3/4 rounded bg-gray-200/70 dark:bg-white/10" aria-hidden="true" />
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  if (memes.length === 0) {
    if (error) {
      return (
        <div className="glass p-6 text-gray-800 dark:text-gray-200">
          <div className="font-semibold mb-1">{t('common.requestFailed', { defaultValue: 'Request failed' })}</div>
          <div className="text-sm text-gray-600 dark:text-gray-400">
            {t('dashboard.failedToLoadMemes', { defaultValue: 'Failed to load memes.' })}
          </div>
          {onRetry ? (
            <div className="mt-4">
              <Button type="button" variant="secondary" onClick={onRetry}>
                {t('common.retry', { defaultValue: 'Retry' })}
              </Button>
            </div>
          ) : null}
        </div>
      );
    }

    return (
      <div className="glass p-6 text-gray-800 dark:text-gray-200">
        <div className="font-semibold mb-1">{t('dashboard.noMemes', { defaultValue: 'No memes yet' })}</div>
        <div className="text-sm text-gray-600 dark:text-gray-400">
          {t('dashboard.noMemesHint', { defaultValue: 'Submit your first meme to build your library.' })}
        </div>
      </div>
    );
  }

  return (
    <div className="meme-masonry">
      {memes.map((meme) => (
        <HelpTooltip
          key={getMemePrimaryId(meme)}
          content={t('help.memes.open', { defaultValue: 'Open meme details. Here you can edit or delete it.' })}
        >
          <MemeCard
            meme={meme}
            onClick={() => onSelectMeme(meme)}
            isOwner={true}
            previewMode={autoplayPreview}
          />
        </HelpTooltip>
      ))}
      <div ref={loadMoreRef} className="h-10" />
      {loadingMore && (
        <div className="flex items-center justify-center gap-2 text-xs text-gray-500 dark:text-gray-400 py-2">
          <Spinner className="h-4 w-4" />
          {t('common.loading', { defaultValue: 'Loading…' })}
        </div>
      )}
    </div>
  );
}


