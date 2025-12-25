import { useTranslation } from 'react-i18next';

import { NeedsChangesSubmissionCard } from './NeedsChangesSubmissionCard';

import type { RefCallback } from 'react';
import type { MySubmission } from '../types';

import { IconButton } from '@/shared/ui';

export type MySubmissionsSectionMode = 'needs_changes' | 'history';

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

export function MySubmissionsSection(props: {
  title?: string;
  mode: MySubmissionsSectionMode;
  submissions: MySubmission[];
  loading: boolean;
  onRefresh: () => void;
  containerRef?: RefCallback<HTMLElement>;
}) {
  const { title, mode, submissions, loading, onRefresh, containerRef } = props;
  const { t } = useTranslation();

  return (
    <section
      ref={containerRef}
      className="mt-6 surface"
      aria-labelledby="my-submissions-title"
    >
      <header className="surface-header">
        <h3 id="my-submissions-title" className="text-xl font-bold dark:text-white">
          {title || t('submit.mySubmissions', { defaultValue: 'My submissions' })}
        </h3>
        <IconButton
          type="button"
          onClick={onRefresh}
          disabled={loading}
          variant="secondary"
          aria-label={t('common.retry', { defaultValue: 'Refresh' })}
          title={t('common.retry', { defaultValue: 'Refresh' })}
          icon={<RefreshIcon spinning={loading} />}
        />
      </header>

      <div className="surface-body">
        {submissions.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {mode === 'needs_changes'
              ? t('submit.noNeedsChanges', { defaultValue: 'Nothing to fix right now.' })
              : t('submit.noSubmissionsYet', { defaultValue: 'No submissions yet.' })}
          </p>
        ) : (
          <ul className="space-y-3" role="list">
            {submissions.slice(0, 50).map((s) => {
              if (mode === 'needs_changes' || s.status === 'needs_changes') {
                return (
                  <li key={s.id}>
                    <NeedsChangesSubmissionCard submission={s} onUpdated={onRefresh} />
                  </li>
                );
              }

              const statusColor =
                s.status === 'approved'
                  ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                  : s.status === 'rejected'
                    ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
                    : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200';

              return (
                <li key={s.id}>
                  <article className="glass p-4">
                    <header className="flex items-start justify-between gap-4">
                      <div>
                        <div className="font-semibold text-gray-900 dark:text-white">{s.title}</div>
                        <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                          {new Date(s.createdAt).toLocaleString()}
                        </div>
                      </div>
                      <span className={`px-2 py-1 rounded text-xs font-semibold ${statusColor}`}>
                        {s.status === 'approved'
                          ? t('submissions.statusApproved', { defaultValue: 'approved' })
                          : s.status === 'rejected'
                            ? t('submissions.statusRejected', { defaultValue: 'rejected' })
                            : t('submissions.statusPending', { defaultValue: 'pending' })}
                      </span>
                    </header>

                    {s.status === 'rejected' && (
                      <section
                        className="mt-3 text-sm text-gray-700 dark:text-gray-300"
                        aria-label={t('submissions.rejectionReasonTitle', { defaultValue: 'Rejection reason' })}
                      >
                        <div className="font-semibold mb-1">
                          {t('submissions.rejectionReasonTitle', { defaultValue: 'Rejection reason' })}
                        </div>
                        <div className="text-gray-600 dark:text-gray-400 whitespace-pre-wrap">
                          {s.moderatorNotes?.trim()
                            ? s.moderatorNotes
                            : t('submissions.noReasonProvided', { defaultValue: 'No reason provided.' })}
                        </div>
                      </section>
                    )}
                  </article>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}


