import { useTranslation } from 'react-i18next';

import type { PendingFilters } from '@/features/dashboard/ui/panels/submissions/model/types';

import { Input, Select } from '@/shared/ui';

type PendingSubmissionsFiltersProps = {
  aiEnabled: boolean;
  filters: PendingFilters;
  onChange: (next: PendingFilters) => void;
};

export function PendingSubmissionsFilters({ aiEnabled, filters, onChange }: PendingSubmissionsFiltersProps) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col md:flex-row gap-2">
        <Input
          value={filters.q}
          onChange={(e) => onChange({ ...filters, q: e.target.value })}
          placeholder={t('dashboard.submissionsFilters.searchPlaceholder', { defaultValue: 'Search by title or name…' })}
          className="flex-1"
        />
        <Select
          value={filters.status}
          onChange={(e) =>
            onChange({
              ...filters,
              status: e.target.value as 'all' | 'pending' | 'approved' | 'rejected',
            })
          }
          className="md:w-48"
          aria-label={t('dashboard.submissionsFilters.statusLabel', { defaultValue: 'Status' })}
        >
          <option value="all">{t('dashboard.submissionsFilters.statusAll', { defaultValue: 'All' })}</option>
          <option value="pending">{t('submissions.statusPending', { defaultValue: 'pending' })}</option>
          <option value="approved">{t('submissions.statusApproved', { defaultValue: 'approved' })}</option>
          <option value="rejected">{t('submissions.statusRejected', { defaultValue: 'rejected' })}</option>
        </Select>
      </div>
      <div className="flex flex-col md:flex-row gap-2">
        {aiEnabled ? (
          <Select
            value={filters.aiStatus}
            onChange={(e) =>
              onChange({
                ...filters,
                aiStatus: e.target.value as 'all' | 'pending' | 'processing' | 'done' | 'failed',
              })
            }
            className="md:w-48"
            aria-label={t('dashboard.submissionsFilters.aiStatusLabel', { defaultValue: 'AI status' })}
          >
            <option value="all">{t('dashboard.submissionsFilters.aiStatusAll', { defaultValue: 'AI: all' })}</option>
            <option value="pending">{t('dashboard.submissionsFilters.aiStatusPending', { defaultValue: 'AI: pending' })}</option>
            <option value="processing">{t('dashboard.submissionsFilters.aiStatusProcessing', { defaultValue: 'AI: processing' })}</option>
            <option value="done">{t('dashboard.submissionsFilters.aiStatusDone', { defaultValue: 'AI: done' })}</option>
            <option value="failed">{t('dashboard.submissionsFilters.aiStatusFailed', { defaultValue: 'AI: failed' })}</option>
          </Select>
        ) : null}
        <Select
          value={filters.sort}
          onChange={(e) =>
            onChange({
              ...filters,
              sort: e.target.value as 'newest-first' | 'oldest-first',
            })
          }
          className="md:w-48"
          aria-label={t('dashboard.submissionsFilters.sortLabel', { defaultValue: 'Sort' })}
        >
          <option value="newest-first">{t('dashboard.submissionsFilters.sortNewest', { defaultValue: 'Newest first' })}</option>
          <option value="oldest-first">{t('dashboard.submissionsFilters.sortOldest', { defaultValue: 'Oldest first' })}</option>
        </Select>
      </div>
    </div>
  );
}
