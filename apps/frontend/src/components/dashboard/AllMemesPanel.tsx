import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';
import { useDebounce } from '../../hooks/useDebounce';
import MemeCard from '../MemeCard';
import type { Meme } from '../../types';

type Props = {
  isOpen: boolean;
  channelId: string;
  autoplayPreview: 'autoplayMuted' | 'hoverWithSound';
  onClose: () => void;
  onSelectMeme: (meme: Meme) => void;
};

export function AllMemesPanel({ isOpen, channelId, autoplayPreview, onClose, onSelectMeme }: Props) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounce(query, 350);
  const [includeUploader, setIncludeUploader] = useState(false);
  const [filters, setFilters] = useState({
    sortBy: 'createdAt',
    sortOrder: 'desc',
  });

  const [memes, setMemes] = useState<Meme[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  const limit = 40;

  const paramsBase = useMemo(() => {
    const params = new URLSearchParams();
    params.set('channelId', channelId);
    if (debouncedQuery.trim()) params.set('q', debouncedQuery.trim());
    if (includeUploader) params.set('includeUploader', '1');
    params.set('sortBy', filters.sortBy);
    params.set('sortOrder', filters.sortOrder);
    params.set('limit', String(limit));
    return params;
  }, [channelId, debouncedQuery, filters, includeUploader]);

  const loadPage = async (offset: number) => {
    const params = new URLSearchParams(paramsBase);
    params.set('offset', String(offset));
    const page = await api.get<Meme[]>(`/channels/memes/search?${params.toString()}`);
    return page;
  };

  // Reset + load first page when panel opens or filters change
  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    setHasMore(true);
    void (async () => {
      try {
        const first = await loadPage(0);
        setMemes(first);
        setHasMore(first.length === limit);
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, paramsBase.toString()]);

  // Infinite scroll
  useEffect(() => {
    if (!isOpen) return;
    if (!hasMore) return;
    if (loading || loadingMore) return;
    const el = loadMoreRef.current;
    if (!el) return;

    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setLoadingMore(true);
            void (async () => {
              try {
                const next = await loadPage(memes.length);
                setMemes((prev) => [...prev, ...next]);
                setHasMore(next.length === limit);
              } finally {
                setLoadingMore(false);
              }
            })();
            return;
          }
        }
      },
      { root: null, rootMargin: '500px 0px', threshold: 0.01 }
    );

    obs.observe(el);
    return () => obs.disconnect();
  }, [isOpen, hasMore, loading, loadingMore, memes.length]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <section
      className={`${isOpen ? 'block' : 'hidden'} surface max-w-6xl mx-auto`}
      aria-label={t('dashboard.allMemesTitle', { defaultValue: 'All memes' })}
    >
      <div className="surface-header">
        <div className="flex items-center gap-3 min-w-0">
          <h2 className="text-xl font-bold dark:text-white truncate">
            {t('dashboard.allMemesTitle', { defaultValue: 'All memes' })}
          </h2>
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {loading ? t('common.loading') : `${memes.length}`}
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

      <div className="surface-body">
        {/* Controls */}
        <div className="glass p-4 mb-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('search.placeholder', 'Search memes...')}
              className="md:col-span-2 rounded-lg px-3 py-2 bg-white/60 dark:bg-white/10 text-gray-900 dark:text-white shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
            <select
              value={`${filters.sortBy}:${filters.sortOrder}`}
              onChange={(e) => {
                const [sortBy, sortOrder] = e.target.value.split(':');
                setFilters((p) => ({ ...p, sortBy, sortOrder }));
              }}
              className="rounded-lg px-3 py-2 bg-white/60 dark:bg-white/10 text-gray-900 dark:text-white shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              <option value="createdAt:desc">{t('search.sortNewest', 'Newest')}</option>
              <option value="createdAt:asc">{t('search.sortOldest', 'Oldest')}</option>
              <option value="popularity:desc">{t('search.sortPopular', 'Popular (30d)')}</option>
            </select>
            <button
              type="button"
              onClick={() => setIncludeUploader((v) => !v)}
              className={`glass-btn px-3 py-2 text-sm font-medium ${
                includeUploader ? 'bg-primary text-white' : 'bg-white/40 dark:bg-white/5 text-gray-900 dark:text-white'
              }`}
              title={t('search.includeUploader', 'Search uploader nick')}
            >
              {t('search.uploader', 'Uploader')}
            </button>
          </div>
        </div>

        {loading && memes.length === 0 ? (
          <div className="text-center py-8 text-gray-500 dark:text-gray-400">{t('common.loading')}</div>
        ) : memes.length === 0 ? (
          <div className="rounded-lg bg-gray-50 dark:bg-gray-900/30 p-6 text-gray-700 dark:text-gray-300 shadow-sm">
            <div className="font-semibold mb-1">{t('dashboard.noMemes', { defaultValue: 'No memes yet' })}</div>
            <div className="text-sm text-gray-600 dark:text-gray-400">
              {t('dashboard.noMemesHint', { defaultValue: 'Submit your first meme to build your library.' })}
            </div>
          </div>
        ) : (
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
        )}
      </div>
    </section>
  );
}


