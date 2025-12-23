import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/shared/lib/cn';
import type { Submission, SubmissionStatus } from '@/types';

export type ChannelSubmissionsSectionProps = {
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

function statusPillClass(status: string): string {
  if (status === 'approved') return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200';
  if (status === 'rejected') return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200';
  if (status === 'needs_changes') return 'bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-200';
  return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200';
}

export function ChannelSubmissionsSection({
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

  return (
    <section className="mt-6 bg-white dark:bg-gray-800 rounded-lg shadow p-6 border border-secondary/20">
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
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
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50 text-gray-800 dark:text-gray-200 font-semibold py-2 px-3 rounded-lg transition-colors"
          >
            {loading ? t('common.loading', { defaultValue: 'Loading...' }) : t('common.retry', { defaultValue: 'Refresh' })}
          </button>
        </div>
      </header>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
        {(['pending', 'needs_changes', 'approved', 'rejected'] as SubmissionStatus[]).map((s) => (
          <div key={s} className="rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2">
            <div className="text-[11px] text-gray-500 dark:text-gray-400">{statusLabel(t, s)}</div>
            <div className="text-lg font-bold text-gray-900 dark:text-white">{stats[s] || 0}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-col sm:flex-row gap-2 mb-3">
        <input
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder={t('submit.searchByUserOrTitle', { defaultValue: 'Search by user or title…' })}
          className="flex-1 border border-secondary/30 dark:border-secondary/30 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-2 focus:ring-2 focus:ring-primary focus:border-primary"
        />
        <select
          value={statusFilter}
          onChange={(e) => onStatusFilterChange(e.target.value as 'all' | SubmissionStatus)}
          className="border border-secondary/30 dark:border-secondary/30 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-2 focus:ring-2 focus:ring-primary focus:border-primary"
          aria-label={t('submit.statusFilter', { defaultValue: 'Status' })}
        >
          <option value="all">{t('submit.allStatuses', { defaultValue: 'All statuses' })}</option>
          <option value="pending">{statusLabel(t, 'pending')}</option>
          <option value="needs_changes">{statusLabel(t, 'needs_changes')}</option>
          <option value="approved">{statusLabel(t, 'approved')}</option>
          <option value="rejected">{statusLabel(t, 'rejected')}</option>
        </select>
      </div>

      {selectedSubmitterId && (
        <div className="mb-3">
          <button
            type="button"
            onClick={onClearSubmitter}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold bg-primary/10 text-primary hover:bg-primary/15 transition-colors"
            title={t('submit.clearUserFilter', { defaultValue: 'Clear user filter' })}
          >
            <span className="truncate max-w-[240px]">
              {t('submit.filteredByUser', { defaultValue: 'Filtered by:' })} {selectedSubmitterName || selectedSubmitterId}
            </span>
            <span className="text-base leading-none">×</span>
          </button>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="text-sm text-gray-500 dark:text-gray-400">
          {t('submit.noChannelSubmissions', { defaultValue: 'No submissions found for the current filters.' })}
        </div>
      ) : (
        <ul className="space-y-3" role="list">
          {filtered.slice(0, 80).map((s) => (
            <li key={s.id}>
              <article className="border border-gray-200 dark:border-gray-700 rounded-lg p-4">
                <header className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="font-semibold text-gray-900 dark:text-white truncate">{s.title}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-600 dark:text-gray-400">
                      <button
                        type="button"
                        className={cn(
                          'font-semibold text-primary hover:text-secondary transition-colors',
                          selectedSubmitterId && s.submitter?.id === selectedSubmitterId ? 'underline' : '',
                        )}
                        onClick={() => {
                          if (s.submitter?.id && s.submitter?.displayName) {
                            onSelectSubmitter(s.submitter.id, s.submitter.displayName);
                          }
                        }}
                        title={t('submit.filterByUser', { defaultValue: 'Filter by this user' })}
                      >
                        {s.submitter?.displayName || t('submit.unknownUser', { defaultValue: 'Unknown' })}
                      </button>
                      <span aria-hidden="true">•</span>
                      <span>{new Date(s.createdAt).toLocaleString()}</span>
                    </div>
                  </div>
                  <span className={`px-2 py-1 rounded text-xs font-semibold ${statusPillClass(s.status)}`}>
                    {statusLabel(t, s.status)}
                  </span>
                </header>
              </article>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}


