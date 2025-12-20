import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import VideoPreview from '../VideoPreview';
import type { Submission } from '../../types';

type Props = {
  isOpen: boolean;
  submissions: Submission[];
  submissionsLoading: boolean;
  loadingMore: boolean;
  pendingCount: number;
  hasMore: boolean;
  onClose: () => void;
  onApprove: (submissionId: string) => void;
  onReject: (submissionId: string) => void;
  onLoadMore: () => void;
};

export function PendingSubmissionsPanel({
  isOpen,
  submissions,
  submissionsLoading,
  loadingMore,
  pendingCount,
  hasMore,
  onClose,
  onApprove,
  onReject,
  onLoadMore,
}: Props) {
  const { t } = useTranslation();
  const pendingSubmissions = useMemo(() => submissions.filter((s) => s.status === 'pending'), [submissions]);

  return (
    <section
      className={`${isOpen ? 'block' : 'hidden'} bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-secondary/20`}
      aria-label={t('dashboard.pendingSubmissionsTitle', 'Pending submissions')}
    >
      <div className="flex items-center justify-between px-6 py-4 border-b border-secondary/20">
        <div className="flex items-center gap-3 min-w-0">
          <h2 className="text-xl font-bold dark:text-white truncate">
            {t('dashboard.pendingSubmissionsTitle', 'Pending submissions')}
          </h2>
          {pendingCount > 0 && (
            <span className="bg-red-500 text-white text-xs font-bold rounded-full px-2.5 py-1">
              {pendingCount}
            </span>
          )}
          {submissionsLoading && (
            <span className="text-xs text-gray-500 dark:text-gray-400">{t('common.loading')}</span>
          )}
        </div>
        <button
          onClick={onClose}
          className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          aria-label={t('common.close', { defaultValue: 'Close' })}
        >
          <svg className="w-5 h-5 text-gray-600 dark:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="p-6">
        {pendingSubmissions.length === 0 ? (
          <div className="rounded-lg border border-secondary/20 bg-gray-50 dark:bg-gray-900/30 p-6 text-gray-700 dark:text-gray-300">
            <div className="font-semibold mb-1">{t('dashboard.noPendingSubmissions', 'No pending submissions')}</div>
            <div className="text-sm text-gray-600 dark:text-gray-400">
              {t('dashboard.noPendingSubmissionsHint', { defaultValue: 'New submissions will appear here automatically.' })}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {pendingSubmissions.map((submission) => (
              <div key={submission.id} className="rounded-xl border border-secondary/20 bg-white dark:bg-gray-800 p-5 shadow-sm">
                <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4 mb-4">
                  <div className="min-w-0">
                    <h3 className="font-semibold text-lg dark:text-white truncate">{submission.title}</h3>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      {t('dashboard.submittedBy', { defaultValue: 'Submitted by {{name}}', name: submission.submitter?.displayName || 'Unknown' })}
                    </p>
                    {submission.notes && (
                      <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{submission.notes}</p>
                    )}
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button
                      onClick={() => onApprove(submission.id)}
                      className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg transition-colors font-semibold"
                    >
                      {t('admin.approve', 'Approve')}
                    </button>
                    <button
                      onClick={() => onReject(submission.id)}
                      className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg transition-colors font-semibold"
                    >
                      {t('admin.reject', 'Reject')}
                    </button>
                  </div>
                </div>
                <VideoPreview src={submission.fileUrlTemp} title={submission.title} className="w-full" />
              </div>
            ))}
            {hasMore && (
              <div className="flex justify-center pt-2">
                <button
                  onClick={onLoadMore}
                  disabled={submissionsLoading || loadingMore}
                  className="px-4 py-2 rounded-lg border border-secondary/30 text-sm font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-60"
                >
                  {loadingMore ? t('common.loading') : t('common.loadMore', { defaultValue: 'Load more' })}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}


