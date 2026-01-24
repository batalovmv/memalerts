import { useTranslation } from 'react-i18next';

import { HelpTooltip, IconButton, Input } from '@/shared/ui';

type StreamerProfileSearchProps = {
  searchQuery: string;
  onChangeSearchQuery: (next: string) => void;
  onClearSearchQuery: () => void;
  myFavorites: boolean;
  onToggleFavorites: () => void;
  isAuthed: boolean;
  onRequireAuth: () => void;
  isSearching: boolean;
  searchResultsCount: number;
  mix: (cssVar: '--primary-color' | '--secondary-color' | '--accent-color', percent: number) => string;
};

export function StreamerProfileSearch({
  searchQuery,
  onChangeSearchQuery,
  onClearSearchQuery,
  myFavorites,
  onToggleFavorites,
  isAuthed,
  onRequireAuth,
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

      <div className="mt-3 flex items-center gap-3 flex-wrap">
        <HelpTooltip
          content={
            isAuthed
              ? t('help.profile.favorites', { defaultValue: 'Show only your favorite memes.' })
              : t('help.profile.loginToUseFavorites', { defaultValue: 'Log in to use favorites.' })
          }
        >
          <button
            type="button"
            className={`inline-flex items-center gap-2 text-sm rounded-full px-4 py-2 border shadow-sm transition-colors select-none ${
              !isAuthed
                ? 'opacity-60 cursor-not-allowed bg-white/60 dark:bg-gray-900/40 border-gray-200/60 dark:border-white/10 text-gray-500 dark:text-gray-400'
                : myFavorites
                  ? 'bg-white/80 dark:bg-gray-900/60 border-accent/30 text-accent'
                  : 'bg-white/70 dark:bg-gray-900/40 border-gray-200/60 dark:border-white/10 text-gray-700 dark:text-gray-200 hover:bg-white/80 dark:hover:bg-white/10'
            }`}
            onClick={() => {
              if (!isAuthed) {
                onRequireAuth();
                return;
              }
              onToggleFavorites();
            }}
            aria-pressed={myFavorites}
          >
            <svg
              className={`w-4 h-4 ${myFavorites ? 'text-accent' : 'text-gray-500 dark:text-gray-300'}`}
              viewBox="0 0 24 24"
              fill={myFavorites ? 'currentColor' : 'none'}
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 21s-7-4.535-9.5-8.5C.5 9.5 2.5 6 6.5 6c2.04 0 3.57 1.1 4.5 2.2C11.93 7.1 13.46 6 15.5 6c4 0 6 3.5 4 6.5C19 16.465 12 21 12 21z"
              />
            </svg>
            {t('search.myFavorites', 'My favorites')}
          </button>
        </HelpTooltip>
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
