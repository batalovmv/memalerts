import { useState, useEffect, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '@/lib/api';
import Header from '@/components/Header';
import type { Meme, Tag } from '@/types';
import { useDebounce } from '@/hooks/useDebounce';

export default function Search() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const [query, setQuery] = useState(searchParams.get('q') || '');
  const [selectedTags, setSelectedTags] = useState<string[]>(
    searchParams.get('tags')?.split(',').filter(Boolean) || []
  );
  const [availableTags, setAvailableTags] = useState<Tag[]>([]);
  const [memes, setMemes] = useState<Meme[]>([]);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState({
    minPrice: searchParams.get('minPrice') || '',
    maxPrice: searchParams.get('maxPrice') || '',
    sortBy: searchParams.get('sortBy') || 'createdAt',
    sortOrder: searchParams.get('sortOrder') || 'desc',
  });

  const debouncedQuery = useDebounce(query, 500);

  // Fetch available tags
  useEffect(() => {
    // We'll get tags from search results, but for now we can fetch all tags
    // For simplicity, we'll extract unique tags from search results
  }, []);

  // Perform search
  const performSearch = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (debouncedQuery) params.append('q', debouncedQuery);
      if (selectedTags.length > 0) params.append('tags', selectedTags.join(','));
      if (filters.minPrice) params.append('minPrice', filters.minPrice);
      if (filters.maxPrice) params.append('maxPrice', filters.maxPrice);
      params.append('sortBy', filters.sortBy);
      params.append('sortOrder', filters.sortOrder);
      params.append('limit', '50');

      const memes = await api.get<Meme[]>(`/channels/memes/search?${params.toString()}`);
      setMemes(memes);

      // Extract unique tags from results
      const allTags = new Map<string, Tag>();
      memes.forEach((meme) => {
        meme.tags?.forEach((tagItem) => {
          if (!allTags.has(tagItem.tag.id)) {
            allTags.set(tagItem.tag.id, tagItem.tag);
          }
        });
      });
      setAvailableTags(Array.from(allTags.values()));

      // Update URL without spamming history while typing/filtering.
      setSearchParams(params, { replace: true });
    } catch (error: unknown) {
      // On failures, show empty state instead of stale results.
      setMemes([]);
      setAvailableTags([]);
    } finally {
      setLoading(false);
    }
  }, [debouncedQuery, selectedTags, filters, setSearchParams]);

  useEffect(() => {
    performSearch();
  }, [performSearch]);

  const toggleTag = (tagName: string) => {
    if (selectedTags.includes(tagName)) {
      setSelectedTags(selectedTags.filter((t) => t !== tagName));
    } else {
      setSelectedTags([...selectedTags, tagName]);
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900">
      <Header />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Search Bar */}
        <div className="mb-6 bg-white dark:bg-gray-800 rounded-lg shadow p-6">
          <div className="mb-4">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('search.placeholder')}
              className="w-full border border-gray-300 rounded-lg px-4 py-2 text-lg"
            />
          </div>

          {/* Filters */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('search.minPrice')}
              </label>
              <input
                type="number"
                value={filters.minPrice}
                onChange={(e) => setFilters({ ...filters, minPrice: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2"
                min="0"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('search.maxPrice')}
              </label>
              <input
                type="number"
                value={filters.maxPrice}
                onChange={(e) => setFilters({ ...filters, maxPrice: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2"
                min="0"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('search.sortBy')}
              </label>
              <select
                value={filters.sortBy}
                onChange={(e) => setFilters({ ...filters, sortBy: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2"
              >
                <option value="createdAt">{t('search.sortDate')}</option>
                <option value="priceCoins">{t('search.sortPrice')}</option>
                <option value="popularity">{t('search.sortPopularity')}</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('search.order')}
              </label>
              <select
                value={filters.sortOrder}
                onChange={(e) => setFilters({ ...filters, sortOrder: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2"
              >
                <option value="desc">{t('search.descending')}</option>
                <option value="asc">{t('search.ascending')}</option>
              </select>
            </div>
          </div>

          {/* Tag Filters */}
          {availableTags.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t('search.filterByTags')}
              </label>
              <div className="flex flex-wrap gap-2">
                {availableTags.map((tag) => (
                  <button
                    key={tag.id}
                    onClick={() => toggleTag(tag.name)}
                    className={`px-3 py-1 rounded-full text-sm transition-colors ${
                      selectedTags.includes(tag.name)
                        ? 'bg-primary text-white'
                        : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
                    }`}
                  >
                    {tag.name}
                    {selectedTags.includes(tag.name) && ' Г—'}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Results */}
        {loading ? (
          <div className="text-center py-8">{t('common.loading')}</div>
        ) : memes.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            {query || selectedTags.length > 0
              ? t('search.noResults')
              : t('search.enterQuery')}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {memes.map((meme) => (
              <div
                key={meme.id}
                className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden cursor-pointer hover:shadow-lg transition-shadow"
                onClick={() => navigate(`/channel/${meme.channelId}`)}
              >
                <div className="p-4">
                  <h3 className="font-semibold text-lg mb-2 dark:text-white">{meme.title}</h3>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-gray-600 dark:text-gray-400">{meme.type.toUpperCase()}</span>
                    <span className="text-lg font-bold text-primary">
                      {meme.priceCoins} {t('profile.coins')}
                    </span>
                  </div>
                  {meme.tags && meme.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {meme.tags.map((tagItem, idx) => (
                        <span
                          key={idx}
                          className="px-2 py-1 bg-accent/20 text-accent rounded text-xs"
                        >
                          {tagItem.tag.name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}


