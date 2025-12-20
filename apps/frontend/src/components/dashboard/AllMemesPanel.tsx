import { useTranslation } from 'react-i18next';
import MemeCard from '../MemeCard';
import type { Meme } from '../../types';

type Props = {
  isOpen: boolean;
  memes: Meme[];
  memesLoading: boolean;
  autoplayPreview: 'autoplayMuted' | 'hoverWithSound';
  onClose: () => void;
  onSelectMeme: (meme: Meme) => void;
};

export function AllMemesPanel({ isOpen, memes, memesLoading, autoplayPreview, onClose, onSelectMeme }: Props) {
  const { t } = useTranslation();

  return (
    <section
      className={`${isOpen ? 'block' : 'hidden'} bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-secondary/20`}
      aria-label={t('dashboard.allMemesTitle', { defaultValue: 'All memes' })}
    >
      <div className="flex items-center justify-between px-6 py-4 border-b border-secondary/20">
        <div className="flex items-center gap-3 min-w-0">
          <h2 className="text-xl font-bold dark:text-white truncate">
            {t('dashboard.allMemesTitle', { defaultValue: 'All memes' })}
          </h2>
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {memesLoading ? t('common.loading') : `${memes.length}`}
          </span>
        </div>
        <button
          onClick={onClose}
          className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          aria-label={t('common.close', { defaultValue: 'Close' })}
        >
          <svg className="w-5 h-5 text-gray-600 dark:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="p-6">
        {memesLoading && memes.length === 0 ? (
          <div className="text-center py-8 text-gray-500 dark:text-gray-400">{t('common.loading')}</div>
        ) : memes.length === 0 ? (
          <div className="rounded-lg border border-secondary/20 bg-gray-50 dark:bg-gray-900/30 p-6 text-gray-700 dark:text-gray-300">
            <div className="font-semibold mb-1">{t('dashboard.noMemes', { defaultValue: 'No memes yet' })}</div>
            <div className="text-sm text-gray-600 dark:text-gray-400">
              {t('dashboard.noMemesHint', { defaultValue: 'Submit your first meme to build your library.' })}
            </div>
          </div>
        ) : (
          <div className="columns-2 md:columns-3 lg:columns-4 xl:columns-5 gap-0" style={{ columnGap: 0 }}>
            {memes.map((meme) => (
              <MemeCard
                key={meme.id}
                meme={meme}
                onClick={() => onSelectMeme(meme)}
                isOwner={true}
                previewMode={autoplayPreview}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}


