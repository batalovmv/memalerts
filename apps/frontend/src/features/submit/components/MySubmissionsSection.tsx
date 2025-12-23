import type { RefCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { MySubmission } from '../types';
import { NeedsChangesSubmissionCard } from './NeedsChangesSubmissionCard';

export function MySubmissionsSection(props: {
  mySubmissions: MySubmission[];
  loading: boolean;
  onRefresh: () => void;
  containerRef?: RefCallback<HTMLElement>;
}) {
  const { mySubmissions, loading, onRefresh, containerRef } = props;
  const { t } = useTranslation();

  return (
    <section
      ref={containerRef}
      className="mt-8 bg-white dark:bg-gray-800 rounded-lg shadow p-6 border border-secondary/20"
      aria-labelledby="my-submissions-title"
    >
      <header className="flex items-center justify-between mb-4">
        <h3 id="my-submissions-title" className="text-xl font-bold dark:text-white">
          {t('submit.mySubmissions', { defaultValue: 'My submissions' })}
        </h3>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50 text-gray-800 dark:text-gray-200 font-semibold py-2 px-3 rounded-lg transition-colors"
        >
          {loading ? t('common.loading', { defaultValue: 'Loading...' }) : t('common.retry', { defaultValue: 'Refresh' })}
        </button>
      </header>

      {mySubmissions.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {t('submit.noSubmissionsYet', { defaultValue: 'No submissions yet.' })}
        </p>
      ) : (
        <ul className="space-y-3" role="list">
          {mySubmissions.slice(0, 20).map((s) => {
            if (s.status === 'needs_changes') {
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
                <article className="border border-gray-200 dark:border-gray-700 rounded-lg p-4">
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
                    <section className="mt-3 text-sm text-gray-700 dark:text-gray-300" aria-label={t('submissions.rejectionReasonTitle', { defaultValue: 'Rejection reason' })}>
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
    </section>
  );
}


