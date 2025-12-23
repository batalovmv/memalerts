import { useTranslation } from 'react-i18next';

import type { AllMemesSearchScope, AllMemesSortBy, AllMemesSortOrder } from '../model/useAllMemesPanel';

export type AllMemesControlsProps = {
  query: string;
  onQueryChange: (v: string) => void;
  searchScope: AllMemesSearchScope;
  onSearchScopeChange: (v: AllMemesSearchScope) => void;
  sortBy: AllMemesSortBy;
  sortOrder: AllMemesSortOrder;
  onSortChange: (sortBy: AllMemesSortBy, sortOrder: AllMemesSortOrder) => void;
};

export function AllMemesControls(props: AllMemesControlsProps) {
  const { t } = useTranslation();

  return (
    <div className="glass p-4 mb-4">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <input
          value={props.query}
          onChange={(e) => props.onQueryChange(e.target.value)}
          placeholder={t('search.placeholder', 'Search memes...')}
          className="md:col-span-2 rounded-lg px-3 py-2 bg-white/60 dark:bg-white/10 text-gray-900 dark:text-white shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
        <select
          value={`${props.sortBy}:${props.sortOrder}`}
          onChange={(e) => {
            const [sortBy, sortOrder] = e.target.value.split(':') as [AllMemesSortBy, AllMemesSortOrder];
            props.onSortChange(sortBy, sortOrder);
          }}
          className="rounded-lg px-3 py-2 bg-white/60 dark:bg-gray-900/60 text-gray-900 dark:text-white shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
        >
          <option value="createdAt:desc">{t('search.sortNewest', 'Newest')}</option>
          <option value="createdAt:asc">{t('search.sortOldest', 'Oldest')}</option>
          <option value="popularity:desc">{t('search.sortPopular', 'Popular (30d)')}</option>
        </select>
        <select
          value={props.searchScope}
          onChange={(e) => props.onSearchScopeChange(e.target.value as AllMemesSearchScope)}
          className="rounded-lg px-3 py-2 bg-white/60 dark:bg-gray-900/60 text-gray-900 dark:text-white shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
          title={t('search.searchScope', 'Search scope')}
        >
          <option value="content">{t('search.scopeContent', 'Search: title + tags')}</option>
          <option value="contentAndUploader">{t('search.scopeContentUploader', 'Search: title + tags + uploader nick')}</option>
        </select>
      </div>
    </div>
  );
}


