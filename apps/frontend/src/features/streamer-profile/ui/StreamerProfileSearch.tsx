import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { IconButton, Input } from '@/shared/ui';

type StreamerProfileSearchProps = {
  searchQuery: string;
  onChangeSearchQuery: (next: string) => void;
  onClearSearchQuery: () => void;
  tagFilter: string;
  onClearTagFilter: () => void;
  availableTags: string[];
  onSelectTag: (tag: string) => void;
  isSearching: boolean;
  searchResultsCount: number;
  mix: (cssVar: '--primary-color' | '--secondary-color' | '--accent-color', percent: number) => string;
};

export function StreamerProfileSearch({
  searchQuery,
  onChangeSearchQuery,
  onClearSearchQuery,
  tagFilter,
  onClearTagFilter,
  availableTags,
  onSelectTag,
  isSearching,
  searchResultsCount,
  mix,
}: StreamerProfileSearchProps) {
  const { t } = useTranslation();
  const hasSearch = searchQuery.trim().length > 0 || tagFilter.trim().length > 0;
  const [tagsOpen, setTagsOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const hasTags = availableTags.length > 0;
  const showTagButton = hasTags;
  const showClearButton = searchQuery.trim().length > 0;
  const actionCount = (showTagButton ? 1 : 0) + (showClearButton ? 1 : 0);
  const inputPaddingClass = actionCount > 1 ? 'pr-20' : actionCount === 1 ? 'pr-12' : 'pr-10';
  const visibleTags = useMemo(() => availableTags.slice(0, 24), [availableTags]);

  useEffect(() => {
    if (!tagsOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (!panelRef.current) return;
      if (panelRef.current.contains(e.target as Node)) return;
      setTagsOpen(false);
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setTagsOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [tagsOpen]);

  return (
    <div className="mb-6">
      <div className="relative" ref={panelRef}>
        <Input
          type="text"
          value={searchQuery}
          onChange={(e) => onChangeSearchQuery(e.target.value)}
          placeholder={t('search.placeholder') || 'Search memes...'}
          className={`w-full px-4 py-2 pl-10 ${inputPaddingClass} bg-white/70 dark:bg-gray-900/60 border`}
          style={{ borderColor: mix('--secondary-color', 28) }}
        />
        <svg
          className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
          {showTagButton && (
            <IconButton
              type="button"
              variant="ghost"
              onClick={() => setTagsOpen((prev) => !prev)}
              className="w-8 h-8 p-1.5 text-gray-400 opacity-80 hover:opacity-100 hover:text-gray-600 dark:hover:text-gray-300"
              aria-label={t('search.filterByTags', { defaultValue: 'Filter by tags' })}
              aria-expanded={tagsOpen}
              icon={
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 9h14M5 15h14M10 5h4M10 19h4"
                  />
                </svg>
              }
            />
          )}
          {showClearButton && (
            <IconButton
              type="button"
              variant="ghost"
              onClick={onClearSearchQuery}
              className="w-8 h-8 p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              aria-label={t('common.clear', { defaultValue: 'Clear' })}
              icon={
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              }
            />
          )}
        </div>

        {tagsOpen && hasTags && (
          <div
            className="absolute z-20 mt-2 w-full rounded-xl border border-black/10 dark:border-white/10 bg-white/95 dark:bg-gray-900/95 shadow-xl p-3 backdrop-blur-md"
            role="dialog"
            aria-label={t('search.filterByTags', { defaultValue: 'Filter by tags' })}
          >
            <div className="flex flex-wrap gap-2">
              {visibleTags.map((tag) => {
                const isActive = tagFilter.trim().toLowerCase() === tag.toLowerCase();
                return (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => {
                      onSelectTag(tag);
                      setTagsOpen(false);
                    }}
                    className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 transition-colors ${
                      isActive
                        ? 'bg-primary/15 text-primary ring-primary/30'
                        : 'bg-white/70 dark:bg-white/10 text-gray-700 dark:text-gray-200 ring-black/5 dark:ring-white/10 hover:bg-white/90 dark:hover:bg-white/20'
                    }`}
                    aria-pressed={isActive}
                  >
                    #{tag}
                  </button>
                );
              })}
              {availableTags.length > visibleTags.length ? (
                <span className="inline-flex items-center px-2.5 py-1 text-[11px] text-gray-500 dark:text-gray-400">
                  +{availableTags.length - visibleTags.length}
                </span>
              ) : null}
            </div>
          </div>
        )}
      </div>
      <div className="mt-2 text-xs text-gray-600 dark:text-gray-400">
        {t('search.aiHint', { defaultValue: 'Search includes tags and hidden AI description.' })}
      </div>

      {tagFilter.trim() && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <span className="text-gray-500 dark:text-gray-400">
            {t('search.filterByTags', { defaultValue: 'Filter by Tags' })}:
          </span>
          <button
            type="button"
            onClick={onClearTagFilter}
            className="inline-flex items-center gap-1 rounded-full bg-white/70 dark:bg-white/10 px-2.5 py-1 font-semibold text-gray-700 dark:text-gray-100 ring-1 ring-black/5 dark:ring-white/10 hover:bg-white dark:hover:bg-white/20"
            aria-label={t('common.clear', { defaultValue: 'Clear' })}
          >
            #{tagFilter.trim()}
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {hasSearch && (
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
          {isSearching
            ? t('search.searching') || 'Searching...'
            : searchResultsCount > 0
              ? `${searchResultsCount} ${t('search.resultsFound') || 'results found'}`
              : t('search.noResults') || 'No results found'}
        </p>
      )}
    </div>
  );
}
