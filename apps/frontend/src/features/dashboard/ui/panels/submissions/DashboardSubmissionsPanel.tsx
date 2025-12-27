import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { PanelHeader } from '../../PanelHeader';
import { useLoadMoreOnIntersect } from '../pending-submissions/model/useLoadMoreOnIntersect';
import { PendingSubmissionCard } from '../pending-submissions/PendingSubmissionCard';

import type { MySubmission } from '@/features/submit/types';
import type { Submission } from '@/types';

import { NeedsChangesSubmissionCard } from '@/features/submit/components/NeedsChangesSubmissionCard';
import { resolveMediaUrl } from '@/lib/urls';
import { cn } from '@/shared/lib/cn';
import { IconButton, Modal, Pill, Spinner } from '@/shared/ui';

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

  onClose,
}: DashboardSubmissionsPanelProps) {
  const { t } = useTranslation();
  const [previewModal, setPreviewModal] = useState<{ open: boolean; src: string; title: string }>(() => ({
    open: false,
    src: '',
    title: '',
  }));

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

  // IMPORTANT: "My submissions" tab should show only active submissions (no full history),
  // otherwise counts become huge and the list mixes "current" with "history".
  const myActive = useMemo(
    () => mySubmissions.filter((s) => s.status === 'pending' || s.status === 'needs_changes'),
    [mySubmissions],
  );

  const myCount = myActive.length;
  const mySorted = useMemo(() => {
    // UX: show "needs_changes" first, then pending; both by date desc.
    const byTime = (a: MySubmission, b: MySubmission) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    const needs = myActive.filter((s) => s.status === 'needs_changes').sort(byTime);
    const rest = myActive.filter((s) => s.status !== 'needs_changes').sort(byTime);
    return [...needs, ...rest];
  }, [myActive]);

  function RefreshIcon(props: { spinning?: boolean }) {
    const { spinning } = props;
    return (
      <svg className={`w-5 h-5 ${spinning ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v6h6M20 20v-6h-6M20 9A8 8 0 006.34 6.34M4 15a8 8 0 0013.66 2.66" />
      </svg>
    );
  }

  function HistoryIcon() {
    return (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12a9 9 0 1018 0 9 9 0 00-18 0z" />
      </svg>
    );
  }

  function ChannelIcon() {
    return (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
      </svg>
    );
  }

  const TabButton = (props: { tab: SubmissionsPanelTab; label: string; count?: number; busy?: boolean; emphasis?: 'primary' | 'secondary' }) => {
    const { tab, label, count, busy, emphasis = 'primary' } = props;
    const active = activeTab === tab;
    return (
      <button
        type="button"
        onClick={() => onTabChange(tab)}
        className={[
          'inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors',
          emphasis === 'secondary'
            ? active
              ? 'bg-black/5 dark:bg-white/10 text-gray-900 dark:text-white'
              : 'text-gray-500 dark:text-gray-400 hover:bg-black/5 dark:hover:bg-white/10'
            : active
              ? 'bg-primary/10 text-primary'
              : 'text-gray-700 dark:text-gray-200 hover:bg-black/5 dark:hover:bg-white/10',
        ].join(' ')}
        aria-pressed={active}
      >
        <span>{label}</span>
        {busy ? <Spinner className="h-4 w-4" /> : null}
        {typeof count === 'number' && count > 0 ? (
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
                  onOpenPreview={(data) => {
                    setPreviewModal({ open: true, src: data.src, title: data.title });
                  }}
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
              <IconButton
                type="button"
                variant="secondary"
                onClick={onRefreshMySubmissions}
                disabled={mySubmissionsLoading}
                aria-label={t('common.retry', { defaultValue: 'Повторить' })}
                title={t('common.retry', { defaultValue: 'Повторить' })}
                icon={<RefreshIcon spinning={mySubmissionsLoading} />}
              />

              <IconButton
                type="button"
                variant="secondary"
                disabled={true}
                aria-label={t('dashboard.submissionsPanel.historyTab', { defaultValue: 'История' })}
                title={t('dashboard.submissionsPanel.temporarilyUnavailable', { defaultValue: 'Временно недоступно' })}
                icon={<HistoryIcon />}
              />

              <IconButton
                type="button"
                variant="secondary"
                disabled={true}
                aria-label={t('dashboard.submissionsPanel.channelTab', { defaultValue: 'Заявки канала' })}
                title={t('dashboard.submissionsPanel.temporarilyUnavailable', { defaultValue: 'Временно недоступно' })}
                icon={<ChannelIcon />}
              />
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

                  // Mine tab shows only active items, so non-needs_changes must be pending.
                  return (
                    <li key={s.id}>
                      <article className="glass p-4">
                        <header className="flex items-start justify-between gap-4">
                          <div>
                            <div className="font-semibold text-gray-900 dark:text-white">{s.title}</div>
                            <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">{new Date(s.createdAt).toLocaleString()}</div>
                          </div>
                          <Pill variant="neutral">{t('submissions.statusPending', { defaultValue: 'pending' })}</Pill>
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

      <Modal
        isOpen={previewModal.open}
        onClose={() => setPreviewModal({ open: false, src: '', title: '' })}
        ariaLabel={t('submissions.preview', { defaultValue: 'Submission preview' })}
        contentClassName="max-w-4xl"
      >
        <div className="p-4 sm:p-6">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-lg font-bold dark:text-white truncate">{previewModal.title || t('submissions.preview', { defaultValue: 'Preview' })}</div>
            </div>
            <IconButton
              type="button"
              variant="secondary"
              aria-label={t('common.close', { defaultValue: 'Close' })}
              title={t('common.close', { defaultValue: 'Close' })}
              onClick={() => setPreviewModal({ open: false, src: '', title: '' })}
              icon={
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              }
            />
          </div>

          <div className="mt-4 rounded-xl overflow-hidden bg-black/90 ring-1 ring-black/10 dark:ring-white/10">
            <video src={previewModal.src} controls autoPlay playsInline className="w-full max-h-[70vh] object-contain" />
          </div>
        </div>
      </Modal>
    </section>
  );
}


