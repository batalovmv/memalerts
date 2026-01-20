import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { Submission, SubmissionStatus } from '@/types';

import { cn } from '@/shared/lib/cn';
import { Button, HelpTooltip, IconButton, Input, Pill, Select, Spinner } from '@/shared/ui';

export type ChannelSubmissionsSectionProps = {
  className?: string;
  submissions: Submission[];
  loading: boolean;
  statusFilter: 'all' | SubmissionStatus;
  query: string;
  selectedSubmitterId: string | null;
  selectedSubmitterName: string | null;
  onQueryChange: (q: string) => void;
  onStatusFilterChange: (s: 'all' | SubmissionStatus) => void;
  onSelectSubmitter: (submitterId: string, submitterName: string) => void;
  onClearSubmitter: () => void;
  onRefresh: () => void;
};

function statusLabel(t: ReturnType<typeof useTranslation>['t'], status: string): string {
  if (status === 'pending') return t('submissions.statusPending', { defaultValue: 'pending' });
  if (status === 'approved') return t('submissions.statusApproved', { defaultValue: 'approved' });
  if (status === 'rejected') return t('submissions.statusRejected', { defaultValue: 'rejected' });
  if (status === 'needs_changes') return t('submissions.statusNeedsChanges', { defaultValue: 'needs changes' });
  return status;
}

function statusPillVariant(status: string): 'success' | 'danger' | 'warning' | 'neutral' {
  if (status === 'approved') return 'success';
  if (status === 'rejected') return 'danger';
  if (status === 'needs_changes') return 'warning';
  return 'neutral';
}

function RefreshIcon(props: { spinning?: boolean }) {
  const { spinning } = props;
  return (
    <svg
      className={`w-5 h-5 ${spinning ? 'animate-spin' : ''}`}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M4 4v6h6M20 20v-6h-6M20 9A8 8 0 006.34 6.34M4 15a8 8 0 0013.66 2.66"
      />
    </svg>
  );
}

export function ChannelSubmissionsSection({
  className,
  submissions,
  loading,
  statusFilter,
  query,
  selectedSubmitterId,
  selectedSubmitterName,
  onQueryChange,
  onStatusFilterChange,
  onSelectSubmitter,
  onClearSubmitter,
  onRefresh,
}: ChannelSubmissionsSectionProps) {
  const { t } = useTranslation();

  const stats = useMemo(() => {
    const by: Record<string, number> = { pending: 0, needs_changes: 0, approved: 0, rejected: 0 };
    for (const s of submissions) {
      by[s.status] = (by[s.status] || 0) + 1;
    }
    return by;
  }, [submissions]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return submissions.filter((s) => {
      if (selectedSubmitterId && s.submitter?.id !== selectedSubmitterId) return false;
      if (statusFilter !== 'all' && s.status !== statusFilter) return false;
      if (!q) return true;
      const name = (s.submitter?.displayName || '').toLowerCase();
      const title = (s.title || '').toLowerCase();
      return name.includes(q) || title.includes(q);
    });
  }, [query, selectedSubmitterId, statusFilter, submissions]);

  const hasFilters = !!query.trim() || statusFilter !== 'all' || !!selectedSubmitterId;

  return (
    <section className={cn('surface', className)}>
      <header className="surface-header">
        <div>
          <h3 className="text-xl font-bold dark:text-white">
            {t('submit.channelSubmissionsTitle', { defaultValue: 'Channel submissions' })}
          </h3>
          <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">
            {t('submit.channelSubmissionsHint', {
              defaultValue: 'Click a user to filter. This is a lightweight view of recent submissions.',
            })}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <HelpTooltip content={t('help.submit.refresh', { defaultValue: 'Refresh the list.' })}>
            <IconButton
              type="button"
              onClick={onRefresh}
              disabled={loading}
              variant="secondary"
              aria-label={t('common.retry', { defaultValue: 'Refresh' })}
              icon={<RefreshIcon spinning={loading} />}
            />
          </HelpTooltip>
        </div>
      </header>

      <div className="surface-body">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
          {(['pending', 'needs_changes', 'approved', 'rejected'] as SubmissionStatus[]).map((s) => (
            <div key={s} className="glass px-3 py-2 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[11px] text-gray-500 dark:text-gray-400 truncate">{statusLabel(t, s)}</div>
              </div>
              <HelpTooltip
                content={t('submit.statusCount', {
                  defaultValue: '{{status}}: {{count}}',
                  status: statusLabel(t, s),
                  count: stats[s] || 0,
                })}
              >
                <Pill variant={statusPillVariant(s)}>{stats[s] || 0}</Pill>
              </HelpTooltip>
            </div>
          ))}
        </div>

        <div className="flex flex-col sm:flex-row gap-2 mb-3">
          <Input
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder={t('submit.searchByUserOrTitle', { defaultValue: 'Search by user or title…' })}
            className="flex-1"
          />
          <Select
            value={statusFilter}
            onChange={(e) => onStatusFilterChange(e.target.value as 'all' | SubmissionStatus)}
            aria-label={t('submit.statusFilter', { defaultValue: 'Status' })}
          >
            <option value="all">{t('submit.allStatuses', { defaultValue: 'All statuses' })}</option>
            <option value="pending">{statusLabel(t, 'pending')}</option>
            <option value="needs_changes">{statusLabel(t, 'needs_changes')}</option>
            <option value="approved">{statusLabel(t, 'approved')}</option>
            <option value="rejected">{statusLabel(t, 'rejected')}</option>
          </Select>
        </div>

        {selectedSubmitterId && (
          <div className="mb-3">
            <HelpTooltip content={t('help.submit.clearUserFilter', { defaultValue: 'Clear the user filter.' })}>
              <Button
                type="button"
                onClick={onClearSubmitter}
                variant="ghost"
                size="sm"
                className="rounded-full bg-primary/10 text-primary hover:bg-primary/15"
              >
                <span className="truncate max-w-[240px]">
                  {t('submit.filteredByUser', { defaultValue: 'Filtered by:' })} {selectedSubmitterName || selectedSubmitterId}
                </span>
                <span className="text-base leading-none">×</span>
              </Button>
            </HelpTooltip>
          </div>
        )}

        {loading && submissions.length === 0 ? (
          <div className="glass p-6 text-center">
            <div className="inline-flex items-center gap-3 text-gray-700 dark:text-gray-200">
              <Spinner className="h-5 w-5" />
              <span className="text-sm font-semibold">{t('common.loading', { defaultValue: 'Loading…' })}</span>
            </div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="glass p-6">
            <div className="text-sm font-semibold text-gray-900 dark:text-white">
              {t('submit.noChannelSubmissions', { defaultValue: 'No submissions found for the current filters.' })}
            </div>
            {hasFilters && (
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    onQueryChange('');
                    onStatusFilterChange('all');
                    onClearSubmitter();
                  }}
                >
                  {t('common.clearFilters', { defaultValue: 'Clear filters' })}
                </Button>
              </div>
            )}
          </div>
        ) : (
          <ul className="space-y-3" role="list">
            {filtered.slice(0, 80).map((s) => (
              <li key={s.id}>
                <article className="glass p-4">
                  <header className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="font-semibold text-gray-900 dark:text-white truncate">{s.title}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-600 dark:text-gray-400">
                        <HelpTooltip content={t('help.submit.filterByUser', { defaultValue: 'Show only submissions from this user.' })}>
                          <button
                            type="button"
                            className={cn(
                              'font-semibold text-primary hover:text-secondary transition-colors',
                              selectedSubmitterId && s.submitter?.id === selectedSubmitterId ? 'underline' : '',
                            )}
                            aria-pressed={!!selectedSubmitterId && s.submitter?.id === selectedSubmitterId}
                            onClick={() => {
                              if (s.submitter?.id && s.submitter?.displayName) {
                                onSelectSubmitter(s.submitter.id, s.submitter.displayName);
                              }
                            }}
                          >
                            {s.submitter?.displayName || t('submit.unknownUser', { defaultValue: 'Unknown' })}
                          </button>
                        </HelpTooltip>
                        <span aria-hidden="true">•</span>
                        <span>{new Date(s.createdAt).toLocaleString()}</span>
                      </div>
                    </div>
                    <Pill variant={statusPillVariant(s.status)}>{statusLabel(t, s.status)}</Pill>
                  </header>
                </article>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}


