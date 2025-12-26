import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { PanelHeader } from '../../PanelHeader';
import { useLoadMoreOnIntersect } from './model/useLoadMoreOnIntersect';
import { PendingSubmissionCard } from './PendingSubmissionCard';

import type { Submission } from '@/types';
import { resolveMediaUrl } from '@/lib/urls';
import { cn } from '@/shared/lib/cn';
import { Pill, Spinner } from '@/shared/ui';

export type PendingSubmissionsPanelProps = {
  isOpen: boolean;
  submissions: Submission[];
  submissionsLoading: boolean;
  submissionsLoadingMore: boolean;
  pendingCount: number;
  total: number | null;
  onClose: () => void;
  onLoadMore: () => void;
  onApprove: (submissionId: string) => void;
  onNeedsChanges: (submissionId: string) => void;
  onReject: (submissionId: string) => void;
};

export function PendingSubmissionsPanel({
  isOpen,
  submissions,
  submissionsLoading,
  submissionsLoadingMore,
  pendingCount,
  total,
  onClose,
  onLoadMore,
  onApprove,
  onNeedsChanges,
  onReject,
}: PendingSubmissionsPanelProps) {
  const { t } = useTranslation();

  const pendingSubmissions = useMemo(
    () => submissions.filter((s) => s.status === 'pending'),
    [submissions],
  );
  const hasMore = typeof total === 'number' ? pendingSubmissions.length < total : true;

  const loadMoreRef = useLoadMoreOnIntersect({
    enabled: isOpen,
    hasMore,
    isLoading: submissionsLoading || submissionsLoadingMore,
    onLoadMore,
    rootMargin: '400px 0px',
  });

  const resolveMedia = (src: string): string => resolveMediaUrl(src);

  return (
    <section
      className={cn(isOpen ? 'block' : 'hidden', 'surface max-w-6xl mx-auto')}
      aria-label={t('dashboard.pendingSubmissionsTitle', 'Pending submissions')}
    >
      <PanelHeader
        title={t('dashboard.pendingSubmissionsTitle', 'Pending submissions')}
        meta={
          <div className="flex items-center gap-2">
            {pendingCount > 0 && (
              <Pill variant="danger" title={t('dashboard.pendingCount', { defaultValue: '{{count}} pending', count: pendingCount })}>
                {pendingCount}
              </Pill>
            )}
            {submissionsLoading && (
              <span className="inline-flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                <Spinner className="h-4 w-4" />
                {t('common.loading')}
              </span>
            )}
          </div>
        }
        onClose={onClose}
      />

      <div className="surface-body max-h-[70vh] overflow-y-auto">
        {pendingSubmissions.length === 0 ? (
          <div className="rounded-lg bg-gray-50 dark:bg-gray-900/30 p-6 text-gray-700 dark:text-gray-300 shadow-sm">
            <div className="font-semibold mb-1">{t('dashboard.noPendingSubmissions', 'No pending submissions')}</div>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {t('dashboard.noPendingSubmissionsHint', {
                defaultValue: 'New submissions will appear here automatically.',
              })}
            </p>
          </div>
        ) : (
          <ul className="space-y-4" role="list">
            {pendingSubmissions.map((submission) => (
              <PendingSubmissionCard
                key={submission.id}
                submission={submission}
                resolveMediaUrl={resolveMedia}
                onApprove={onApprove}
                onNeedsChanges={onNeedsChanges}
                onReject={onReject}
              />
            ))}
            {/* Infinite-scroll sentinel */}
            <li ref={loadMoreRef} className="h-8" aria-hidden="true" />
            {submissionsLoadingMore && (
              <li className="flex items-center justify-center gap-2 text-xs text-gray-500 dark:text-gray-400 py-2">
                <Spinner className="h-4 w-4" />
                {t('common.loading', { defaultValue: 'Loading…' })}
              </li>
            )}
          </ul>
        )}
      </div>
    </section>
  );
}


