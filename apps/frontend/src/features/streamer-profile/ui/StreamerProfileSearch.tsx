import { useTranslation } from 'react-i18next';

import { IconButton, Input } from '@/shared/ui';

type StreamerProfileSearchProps = {
  searchQuery: string;
  onChangeSearchQuery: (next: string) => void;
  onClearSearchQuery: () => void;
  isSearching: boolean;
  searchResultsCount: number;
  mix: (cssVar: '--primary-color' | '--secondary-color' | '--accent-color', percent: number) => string;
};

export function StreamerProfileSearch({
  searchQuery,
  onChangeSearchQuery,
  onClearSearchQuery,
  isSearching,
  searchResultsCount,
  mix,
}: StreamerProfileSearchProps) {
  const { t } = useTranslation();

  return (
    <div className="mb-6">
      <div className="relative">
        <Input
          type="text"
          value={searchQuery}
          onChange={(e) => onChangeSearchQuery(e.target.value)}
          placeholder={t('search.placeholder') || 'Search memes...'}
          className="w-full px-4 py-2 pl-10 pr-12 bg-white/70 dark:bg-gray-900/60 border"
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
        {searchQuery && (
          <IconButton
            type="button"
            variant="ghost"
            onClick={onClearSearchQuery}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            aria-label={t('common.clear', { defaultValue: 'Clear' })}
            icon={
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            }
          />
        )}
      </div>
      <div className="mt-2 text-xs text-gray-600 dark:text-gray-400">
        {t('search.aiHint', { defaultValue: 'Search includes tags and hidden AI description.' })}
      </div>

      {searchQuery && (
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
