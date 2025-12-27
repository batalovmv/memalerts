import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { PanelHeader } from '../../PanelHeader';

import { PendingSubmissionCard } from '../pending-submissions/PendingSubmissionCard';
import { useLoadMoreOnIntersect } from '../pending-submissions/model/useLoadMoreOnIntersect';

import type { Submission } from '@/types';
import type { MySubmission } from '@/features/submit/types';

import { NeedsChangesSubmissionCard } from '@/features/submit/components/NeedsChangesSubmissionCard';
import { resolveMediaUrl } from '@/lib/urls';
import { cn } from '@/shared/lib/cn';
import { Button, Pill, Spinner } from '@/shared/ui';

export type SubmissionsPanelTab = 'pending' | 'mine';

export type DashboardSubmissionsPanelProps = {
  isOpen: boolean;
  activeTab: SubmissionsPanelTab;
  onTabChange: (tab: SubmissionsPanelTab) => void;

  // Streamer pending approvals
  submissions: Submission[];
  submissionsLoading: boolean;
  submissionsLoadingMore: boolean;
  pendingCount: number;
  total: number | null;
  onLoadMorePending: () => void;
  onApprove: (submissionId: string) => void;
  onNeedsChanges: (submissionId: string) => void;
  onReject: (submissionId: string) => void;

  // Viewer "my submissions"
  mySubmissions: MySubmission[];
  mySubmissionsLoading: boolean;
  onRefreshMySubmissions: () => void;
  onOpenMySubmissionsPage: () => void;

  onClose: () => void;
};

export function DashboardSubmissionsPanel({
  isOpen,
  activeTab,
  onTabChange,

  submissions,
  submissionsLoading,
  submissionsLoadingMore,
  pendingCount,
  total,
  onLoadMorePending,
  onApprove,
  onNeedsChanges,
  onReject,

  mySubmissions,
  mySubmissionsLoading,
  onRefreshMySubmissions,
  onOpenMySubmissionsPage,

  onClose,
}: DashboardSubmissionsPanelProps) {
  const { t } = useTranslation();

  const pendingSubmissions = useMemo(() => submissions.filter((s) => s.status === 'pending'), [submissions]);
  const hasMorePending = typeof total === 'number' ? pendingSubmissions.length < total : true;

  const loadMoreRef = useLoadMoreOnIntersect({
    enabled: isOpen && activeTab === 'pending',
    hasMore: hasMorePending,
    isLoading: submissionsLoading || submissionsLoadingMore,
    onLoadMore: onLoadMorePending,
    rootMargin: '400px 0px',
  });

  const resolveMedia = (src: string): string => resolveMediaUrl(src);

  const myCount = mySubmissions.length;
  const mySorted = useMemo(() => {
    // Small UX improvement: show "needs_changes" first, then the rest by date desc.
    const byTime = (a: MySubmission, b: MySubmission) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    const needs = mySubmissions.filter((s) => s.status === 'needs_changes').sort(byTime);
    const rest = mySubmissions.filter((s) => s.status !== 'needs_changes').sort(byTime);
    return [...needs, ...rest];
  }, [mySubmissions]);

  const TabButton = (props: { tab: SubmissionsPanelTab; label: string; count: number; busy?: boolean }) => {
    const { tab, label, count, busy } = props;
    const active = activeTab === tab;
    return (
      <button
        type="button"
        onClick={() => onTabChange(tab)}
        className={[
          'inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors',
          active ? 'bg-primary/10 text-primary' : 'text-gray-700 dark:text-gray-200 hover:bg-black/5 dark:hover:bg-white/10',
        ].join(' ')}
        aria-pressed={active}
      >
        <span>{label}</span>
        {busy ? <Spinner className="h-4 w-4" /> : null}
        {count > 0 ? (
          <Pill variant={tab === 'pending' ? 'danger' : 'neutral'} size="sm">
            {count}
          </Pill>
        ) : null}
      </button>
    );
  };

  return (
    <section className={cn(isOpen ? 'block' : 'hidden', 'surface max-w-6xl mx-auto')} aria-label={t('dashboard.submissionsPanel.title', { defaultValue: 'Submissions' })}>
      <PanelHeader
        title={t('dashboard.submissionsPanel.title', { defaultValue: 'Submissions' })}
        meta={
          <div className="flex items-center gap-1">
            <TabButton
              tab="pending"
              label={t('dashboard.submissionsPanel.pendingTab', { defaultValue: 'Pending approvals' })}
              count={pendingCount}
              busy={activeTab === 'pending' && submissionsLoading}
            />
            <TabButton
              tab="mine"
              label={t('dashboard.submissionsPanel.myTab', { defaultValue: 'My submissions' })}
              count={myCount}
              busy={activeTab === 'mine' && mySubmissionsLoading}
            />
          </div>
        }
        onClose={onClose}
      />

      <div className="surface-body max-h-[70vh] overflow-y-auto">
        {activeTab === 'pending' ? (
          pendingSubmissions.length === 0 ? (
            <div className="rounded-lg bg-gray-50 dark:bg-gray-900/30 p-6 text-gray-700 dark:text-gray-300 shadow-sm">
              <div className="font-semibold mb-1">
                {t('dashboard.noPendingSubmissions', { defaultValue: 'No pending submissions' })}
              </div>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {t('dashboard.noPendingSubmissionsHint', { defaultValue: 'New submissions will appear here automatically.' })}
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
              <li ref={loadMoreRef} className="h-8" aria-hidden="true" />
              {submissionsLoadingMore && (
                <li className="flex items-center justify-center gap-2 text-xs text-gray-500 dark:text-gray-400 py-2">
                  <Spinner className="h-4 w-4" />
                  {t('common.loading', { defaultValue: 'Loading…' })}
                </li>
              )}
            </ul>
          )
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-end gap-2">
              <Button type="button" variant="secondary" size="sm" onClick={onRefreshMySubmissions} disabled={mySubmissionsLoading}>
                {t('common.refresh', { defaultValue: 'Refresh' })}
              </Button>
              <Button type="button" variant="secondary" size="sm" onClick={onOpenMySubmissionsPage}>
                {t('dashboard.submissionsPanel.openFull', { defaultValue: 'Open page' })}
              </Button>
            </div>

            {mySubmissionsLoading ? (
              <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                <Spinner className="h-4 w-4" />
                {t('common.loading', { defaultValue: 'Loading…' })}
              </div>
            ) : mySorted.length === 0 ? (
              <div className="rounded-lg bg-gray-50 dark:bg-gray-900/30 p-6 text-gray-700 dark:text-gray-300 shadow-sm">
                <div className="font-semibold mb-1">{t('submit.noSubmissionsYet', { defaultValue: 'No submissions yet.' })}</div>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  {t('dashboard.submissionsPanel.myHint', { defaultValue: 'Here you will see the submissions you sent to other channels.' })}
                </p>
              </div>
            ) : (
              <ul className="space-y-3" role="list">
                {mySorted.slice(0, 50).map((s) => {
                  if (s.status === 'needs_changes') {
                    return (
                      <li key={s.id}>
                        <NeedsChangesSubmissionCard submission={s} onUpdated={onRefreshMySubmissions} />
                      </li>
                    );
                  }

                  return (
                    <li key={s.id}>
                      <article className="glass p-4">
                        <header className="flex items-start justify-between gap-4">
                          <div>
                            <div className="font-semibold text-gray-900 dark:text-white">{s.title}</div>
                            <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">{new Date(s.createdAt).toLocaleString()}</div>
                          </div>
                          <Pill variant={s.status === 'approved' ? 'success' : s.status === 'rejected' ? 'danger' : 'neutral'}>
                            {s.status === 'approved'
                              ? t('submissions.statusApproved', { defaultValue: 'approved' })
                              : s.status === 'rejected'
                                ? t('submissions.statusRejected', { defaultValue: 'rejected' })
                                : t('submissions.statusPending', { defaultValue: 'pending' })}
                          </Pill>
                        </header>
                      </article>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </div>
    </section>
  );
}


