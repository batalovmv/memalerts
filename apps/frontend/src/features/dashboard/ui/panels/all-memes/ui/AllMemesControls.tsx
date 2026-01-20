import { useTranslation } from 'react-i18next';

import type { AllMemesSortOrder, AllMemesStatusFilter } from '../model/useAllMemesPanel';

import { HelpTooltip, Input, Select } from '@/shared/ui';

export type AllMemesControlsProps = {
  query: string;
  onQueryChange: (v: string) => void;
  status: AllMemesStatusFilter;
  onStatusChange: (v: AllMemesStatusFilter) => void;
  sortOrder: AllMemesSortOrder;
  onSortOrderChange: (v: AllMemesSortOrder) => void;
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
            value={props.sortOrder}
            onChange={(e) => props.onSortOrderChange(e.target.value as AllMemesSortOrder)}
          >
            <option value="desc">{t('search.sortNewest', 'Newest')}</option>
            <option value="asc">{t('search.sortOldest', 'Oldest')}</option>
          </Select>
        </HelpTooltip>

        <HelpTooltip content={t('help.memes.filterStatus', { defaultValue: 'Filter memes by status.' })}>
          <Select value={props.status} onChange={(e) => props.onStatusChange(e.target.value as AllMemesStatusFilter)}>
            <option value="all">{t('search.statusAll', 'All statuses')}</option>
            <option value="approved">{t('search.statusApproved', 'Approved')}</option>
            <option value="pending">{t('search.statusPending', 'Pending')}</option>
            <option value="rejected">{t('search.statusRejected', 'Rejected')}</option>
            <option value="disabled">{t('search.statusDisabled', 'Disabled')}</option>
            <option value="deleted">{t('search.statusDeleted', 'Deleted')}</option>
            <option value="inactive">{t('search.statusInactive', 'Inactive')}</option>
            <option value="active">{t('search.statusActive', 'Active')}</option>
          </Select>
        </HelpTooltip>
      </div>
    </div>
  );
}


