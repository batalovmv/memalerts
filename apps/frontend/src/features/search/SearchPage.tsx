import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams, useNavigate } from 'react-router-dom';

import type { Meme, Tag } from '@/types';

import Header from '@/components/Header';
import { useDebounce } from '@/hooks/useDebounce';
import { api } from '@/lib/api';
import { Card, Input, PageShell, Select, Spinner } from '@/shared/ui';

function XSmallIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

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
    <PageShell header={<Header />}>
      <div className="section-gap">
        {/* Search Bar */}
        <div className="surface p-6">
          <div className="mb-4">
            <Input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('search.placeholder')}
              className="text-lg px-4 py-3"
            />
          </div>

          {/* Filters */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t('search.minPrice')}
              </label>
              <Input
                type="number"
                value={filters.minPrice}
                onChange={(e) => setFilters({ ...filters, minPrice: e.target.value })}
                min="0"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t('search.maxPrice')}
              </label>
              <Input
                type="number"
                value={filters.maxPrice}
                onChange={(e) => setFilters({ ...filters, maxPrice: e.target.value })}
                min="0"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t('search.sortBy')}
              </label>
              <Select
                value={filters.sortBy}
                onChange={(e) => setFilters({ ...filters, sortBy: e.target.value })}
              >
                <option value="createdAt">{t('search.sortDate')}</option>
                <option value="priceCoins">{t('search.sortPrice')}</option>
                <option value="popularity">{t('search.sortPopularity')}</option>
              </Select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t('search.order')}
              </label>
              <Select
                value={filters.sortOrder}
                onChange={(e) => setFilters({ ...filters, sortOrder: e.target.value })}
              >
                <option value="desc">{t('search.descending')}</option>
                <option value="asc">{t('search.ascending')}</option>
              </Select>
            </div>
          </div>

          {/* Tag Filters */}
          {availableTags.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                {t('search.filterByTags')}
              </label>
              <div className="flex flex-wrap gap-2">
                {availableTags.map((tag) => (
                  <button
                    key={tag.id}
                    onClick={() => toggleTag(tag.name)}
                    className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ring-1 ${
                      selectedTags.includes(tag.name)
                        ? 'bg-primary/10 dark:bg-primary/20 text-primary ring-primary/20'
                        : 'bg-white/40 dark:bg-white/5 text-gray-800 dark:text-gray-200 ring-black/5 dark:ring-white/10 hover:bg-white/60 dark:hover:bg-white/10'
                    }`}
                    aria-pressed={selectedTags.includes(tag.name)}
                  >
                    {tag.name}
                    {selectedTags.includes(tag.name) ? <XSmallIcon /> : null}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Results */}
        {loading ? (
          <div className="flex items-center justify-center gap-3 py-8 text-gray-600 dark:text-gray-300">
            <Spinner className="h-5 w-5" />
            <span>{t('common.loading')}</span>
          </div>
        ) : memes.length === 0 ? (
          <div className="text-center py-10 surface p-6 text-gray-600 dark:text-gray-300">
            <div className="text-base font-semibold text-gray-900 dark:text-white">
              {query || selectedTags.length > 0 ? t('search.noResults') : t('search.enterQuery')}
            </div>
            {(query || selectedTags.length > 0) && (
              <div className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                {t('search.tryAdjusting', { defaultValue: 'Try changing filters or removing some tags.' })}
              </div>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {memes.map((meme) => (
              <Card
                key={meme.id}
                hoverable
                className="cursor-pointer overflow-hidden"
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
                        <span key={idx} className="px-2 py-1 bg-accent/15 text-accent rounded-md text-xs ring-1 ring-accent/20">
                          {tagItem.tag.name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </PageShell>
  );
}


