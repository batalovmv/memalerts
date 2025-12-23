import { useTranslation } from 'react-i18next';

import MemeCard from '@/components/MemeCard';
import type { Meme } from '@/types';

export type AllMemesGridProps = {
  memes: Meme[];
  loading: boolean;
  loadingMore: boolean;
  loadMoreRef: React.RefObject<HTMLDivElement>;
  autoplayPreview: 'autoplayMuted' | 'hoverWithSound';
  onSelectMeme: (meme: Meme) => void;
};

export function AllMemesGrid({
  memes,
  loading,
  loadingMore,
  loadMoreRef,
  autoplayPreview,
  onSelectMeme,
}: AllMemesGridProps) {
  const { t } = useTranslation();

  if (loading && memes.length === 0) {
    return <div className="text-center py-8 text-gray-500 dark:text-gray-400">{t('common.loading')}</div>;
  }

  if (memes.length === 0) {
    return (
      <div className="rounded-lg bg-gray-50 dark:bg-gray-900/30 p-6 text-gray-700 dark:text-gray-300 shadow-sm">
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
        <MemeCard
          key={meme.id}
          meme={meme}
          onClick={() => onSelectMeme(meme)}
          isOwner={true}
          previewMode={autoplayPreview}
        />
      ))}
      <div ref={loadMoreRef} className="h-10" />
      {loadingMore && (
        <div className="text-center text-xs text-gray-500 dark:text-gray-400">
          {t('common.loading', { defaultValue: 'Loading...' })}
        </div>
      )}
    </div>
  );
}


