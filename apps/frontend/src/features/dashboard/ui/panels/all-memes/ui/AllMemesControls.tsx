import { useTranslation } from 'react-i18next';

import type { AllMemesSearchScope, AllMemesSortBy, AllMemesSortOrder } from '../model/useAllMemesPanel';

import { HelpTooltip, Input, Select } from '@/shared/ui';

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
        <HelpTooltip content={t('help.memes.search', { defaultValue: 'Search your memes by title, id, etc.' })}>
          <Input
            value={props.query}
            onChange={(e) => props.onQueryChange(e.target.value)}
            placeholder={t('search.placeholder', 'Search memes...')}
            className="md:col-span-2"
          />
        </HelpTooltip>

        <HelpTooltip content={t('help.memes.sort', { defaultValue: 'Choose how to sort the list.' })}>
          <Select
            value={`${props.sortBy}:${props.sortOrder}`}
            onChange={(e) => {
              const [sortBy, sortOrder] = e.target.value.split(':') as [AllMemesSortBy, AllMemesSortOrder];
              props.onSortChange(sortBy, sortOrder);
            }}
          >
            <option value="createdAt:desc">{t('search.sortNewest', 'Newest')}</option>
            <option value="createdAt:asc">{t('search.sortOldest', 'Oldest')}</option>
            <option value="priceCoins:desc">{t('search.sortPriceHigh', 'Price: high')}</option>
            <option value="priceCoins:asc">{t('search.sortPriceLow', 'Price: low')}</option>
          </Select>
        </HelpTooltip>

        <HelpTooltip content={t('help.memes.searchScope', { defaultValue: 'Choose what fields the search uses.' })}>
          <Select value={props.searchScope} onChange={(e) => props.onSearchScopeChange(e.target.value as AllMemesSearchScope)}>
            <option value="content">{t('search.scopeContent', 'Search: title')}</option>
            <option value="contentAndUploader">{t('search.scopeContentUploader', 'Search: title + uploader nick')}</option>
          </Select>
        </HelpTooltip>
      </div>
    </div>
  );
}


