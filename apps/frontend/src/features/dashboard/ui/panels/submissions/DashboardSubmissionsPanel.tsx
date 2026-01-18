import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { PanelHeader } from '../../PanelHeader';
import { useLoadMoreOnIntersect } from '../pending-submissions/model/useLoadMoreOnIntersect';
import { PendingSubmissionCard } from '../pending-submissions/PendingSubmissionCard';

import type { MySubmission } from '@/features/submit/types';
import type { Submission } from '@/types';

import { NeedsChangesSubmissionCard } from '@/features/submit/components/NeedsChangesSubmissionCard';
import { useHotkeys } from '@/hooks/useHotkeys';
import { resolveMediaUrl } from '@/lib/urls';
import { cn } from '@/shared/lib/cn';
import { canViewSubmissionAiDescription } from '@/shared/lib/permissions';
import { Button, IconButton, Input, Modal, Pill, Select, Spinner, Tooltip } from '@/shared/ui';
import { useAppSelector } from '@/store/hooks';

export type SubmissionsPanelTab = 'pending' | 'mine';

export type DashboardSubmissionsPanelProps = {
  isOpen: boolean;
  activeTab: SubmissionsPanelTab;
  onTabChange: (tab: SubmissionsPanelTab) => void;
  helpEnabled?: boolean;

  // Streamer pending approvals
  submissions: Submission[];
  submissionsLoading: boolean;
  submissionsLoadingMore: boolean;
  pendingError?: string | null;
  pendingCount: number;
  total: number | null;
  pendingFilters: {
    status: 'all' | 'pending' | 'approved' | 'rejected';
    aiStatus: 'all' | 'pending' | 'processing' | 'done' | 'failed';
    q: string;
    sort: 'newest-first' | 'oldest-first';
  };
  onPendingFiltersChange: (next: {
    status: 'all' | 'pending' | 'approved' | 'rejected';
    aiStatus: 'all' | 'pending' | 'processing' | 'done' | 'failed';
    q: string;
    sort: 'newest-first' | 'oldest-first';
  }) => void;
  onLoadMorePending: () => void;
  onRetryPending?: () => void;
  onApprove: (submissionId: string) => void;
  onNeedsChanges: (submissionId: string) => void;
  onReject: (submissionId: string) => void;
  onBulkAction?: (action: 'approve' | 'reject' | 'needs_changes', submissionIds: string[]) => void;

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
  helpEnabled,

  submissions,
  submissionsLoading,
  submissionsLoadingMore,
  pendingError,
  pendingCount,
  total,
  pendingFilters,
  onPendingFiltersChange,
  onLoadMorePending,
  onRetryPending,
  onApprove,
  onNeedsChanges,
  onReject,
  onBulkAction,

  mySubmissions,
  mySubmissionsLoading,
  onRefreshMySubmissions,

  onClose,
}: DashboardSubmissionsPanelProps) {
  const { t } = useTranslation();
  const { user } = useAppSelector((s) => s.auth);
  const [previewModal, setPreviewModal] = useState<{ open: boolean; src: string; title: string; submission?: Submission | null }>(() => ({
    open: false,
    src: '',
    title: '',
    submission: null,
  }));
  const [focusedIndex, setFocusedIndex] = useState<number>(-1);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const itemRefs = useRef<Record<string, HTMLLIElement | null>>({});
  const selectAllRef = useRef<HTMLInputElement | null>(null);

  const visibleSubmissions = useMemo(() => submissions, [submissions]);
  const hasMorePending = typeof total === 'number' ? visibleSubmissions.length < total : true;
  const focusedSubmission = focusedIndex >= 0 ? visibleSubmissions[focusedIndex] : null;
  const focusedId = focusedSubmission?.id ?? null;
  const visibleIds = useMemo(() => visibleSubmissions.map((s) => s.id), [visibleSubmissions]);

  const loadMoreRef = useLoadMoreOnIntersect({
    enabled: isOpen && activeTab === 'pending',
    hasMore: hasMorePending,
    isLoading: submissionsLoading || submissionsLoadingMore,
    onLoadMore: onLoadMorePending,
    rootMargin: '400px 0px',
  });

  const resolveMedia = (src: string): string => resolveMediaUrl(src);

  useEffect(() => {
    if (visibleSubmissions.length === 0) {
      setFocusedIndex(-1);
      setSelectedIds([]);
      return;
    }

    setSelectedIds((prev) => prev.filter((id) => visibleIds.includes(id)));
    if (focusedId && visibleIds.includes(focusedId)) return;
    setFocusedIndex(0);
  }, [focusedId, visibleIds, visibleSubmissions.length]);

  useEffect(() => {
    if (!focusedId) return;
    const el = itemRefs.current[focusedId];
    if (!el) return;
    el.scrollIntoView({ block: 'nearest' });
  }, [focusedId]);

  const moveFocus = useCallback(
    (delta: number) => {
      if (visibleSubmissions.length === 0) return;
      setFocusedIndex((prev) => {
        const next = prev < 0 ? 0 : Math.max(0, Math.min(visibleSubmissions.length - 1, prev + delta));
        return next;
      });
    },
    [visibleSubmissions.length],
  );

  const toggleSelection = useCallback(
    (id: string | null) => {
      if (!id) return;
      setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    },
    [],
  );

  const clearSelection = useCallback(() => {
    setSelectedIds([]);
  }, []);

  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.includes(id));
  const someVisibleSelected = visibleIds.some((id) => selectedIds.includes(id)) && !allVisibleSelected;

  useEffect(() => {
    if (!selectAllRef.current) return;
    selectAllRef.current.indeterminate = someVisibleSelected;
  }, [someVisibleSelected, allVisibleSelected]);

  const toggleAllVisible = useCallback(
    (checked: boolean) => {
      if (checked) {
        setSelectedIds((prev) => Array.from(new Set([...prev, ...visibleIds])));
      } else {
        setSelectedIds((prev) => prev.filter((id) => !visibleIds.includes(id)));
      }
    },
    [visibleIds],
  );

  useHotkeys(
    (e) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toUpperCase() || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      const key = e.key.toLowerCase();
      if (key === 'a') {
        if (focusedId) onApprove(focusedId);
        return;
      }
      if (key === 'r') {
        if (focusedId) onReject(focusedId);
        return;
      }
      if (key === 'n') {
        if (focusedId) onNeedsChanges(focusedId);
        return;
      }
      if (key === 'arrowleft' || key === 'arrowup') {
        moveFocus(-1);
        return;
      }
      if (key === 'arrowright' || key === 'arrowdown') {
        moveFocus(1);
        return;
      }
      if (key === ' ') {
        e.preventDefault();
        toggleSelection(focusedId);
        return;
      }
      if (key === 'escape') {
        clearSelection();
      }
    },
    [focusedId, onApprove, onReject, onNeedsChanges, moveFocus, toggleSelection, clearSelection],
    isOpen && activeTab === 'pending',
  );

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
          <div className="flex items-center gap-2">
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
            <Tooltip
              delayMs={300}
              content={
                <div className="text-xs text-gray-800 dark:text-gray-100 space-y-1">
                  <div className="font-semibold">{t('dashboard.hotkeys.title', { defaultValue: 'Hotkeys' })}</div>
                  <div>A — {t('dashboard.hotkeys.approve', { defaultValue: 'Approve focused' })}</div>
                  <div>R — {t('dashboard.hotkeys.reject', { defaultValue: 'Reject (notes)' })}</div>
                  <div>N — {t('dashboard.hotkeys.needsChanges', { defaultValue: 'Needs changes (notes)' })}</div>
                  <div>←/↑ — {t('dashboard.hotkeys.prev', { defaultValue: 'Previous item' })}</div>
                  <div>→/↓ — {t('dashboard.hotkeys.next', { defaultValue: 'Next item' })}</div>
                  <div>Space — {t('dashboard.hotkeys.toggle', { defaultValue: 'Toggle selection' })}</div>
                  <div>Esc — {t('dashboard.hotkeys.clear', { defaultValue: 'Clear selection' })}</div>
                  <div>? — {t('dashboard.hotkeys.help', { defaultValue: 'Show hotkeys' })}</div>
                </div>
              }
            >
              <button
                type="button"
                className="inline-flex items-center justify-center w-7 h-7 rounded-lg text-gray-600 dark:text-gray-300 bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/20 transition-colors"
                aria-label={t('dashboard.hotkeys.title', { defaultValue: 'Hotkeys' })}
              >
                ?
              </button>
            </Tooltip>
          </div>
        }
        onClose={onClose}
      />

      <div className="surface-body max-h-[70vh] overflow-y-auto">
        {activeTab === 'pending' ? (
          <div className="space-y-4">
            <div className="flex flex-col gap-2">
              <div className="flex flex-col md:flex-row gap-2">
                <Input
                  value={pendingFilters.q}
                  onChange={(e) => onPendingFiltersChange({ ...pendingFilters, q: e.target.value })}
                  placeholder={t('dashboard.submissionsFilters.searchPlaceholder', { defaultValue: 'Search by title or name…' })}
                  className="flex-1"
                />
                <Select
                  value={pendingFilters.status}
                  onChange={(e) =>
                    onPendingFiltersChange({
                      ...pendingFilters,
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
                <Select
                  value={pendingFilters.aiStatus}
                  onChange={(e) =>
                    onPendingFiltersChange({
                      ...pendingFilters,
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
                <Select
                  value={pendingFilters.sort}
                  onChange={(e) =>
                    onPendingFiltersChange({
                      ...pendingFilters,
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

            {visibleSubmissions.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-black/5 dark:bg-white/5 p-3">
                <label className="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
                  <input
                    ref={selectAllRef}
                    type="checkbox"
                    className="h-4 w-4 rounded border-black/10 dark:border-white/15 bg-white/50 dark:bg-white/10 text-primary focus:ring-2 focus:ring-primary/30"
                    checked={allVisibleSelected}
                    aria-label={t('dashboard.bulk.selectAll', { defaultValue: 'Select all' })}
                    onChange={(e) => toggleAllVisible(e.target.checked)}
                  />
                  <span>{t('dashboard.bulk.selectAll', { defaultValue: 'Select all' })}</span>
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    {t('dashboard.bulk.selectedCount', { defaultValue: 'Selected: {{count}}', count: selectedIds.length })}
                  </span>
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="success"
                    size="sm"
                    disabled={selectedIds.length === 0 || !onBulkAction}
                    onClick={() => onBulkAction?.('approve', selectedIds)}
                  >
                    {t('dashboard.bulk.approveSelected', { defaultValue: 'Approve selected' })}
                  </Button>
                  <Button
                    type="button"
                    variant="warning"
                    size="sm"
                    disabled={selectedIds.length === 0 || !onBulkAction}
                    onClick={() => onBulkAction?.('needs_changes', selectedIds)}
                  >
                    {t('dashboard.bulk.needsChangesSelected', { defaultValue: 'Needs changes' })}
                  </Button>
                  <Button
                    type="button"
                    variant="danger"
                    size="sm"
                    disabled={selectedIds.length === 0 || !onBulkAction}
                    onClick={() => onBulkAction?.('reject', selectedIds)}
                  >
                    {t('dashboard.bulk.rejectSelected', { defaultValue: 'Reject selected' })}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={selectedIds.length === 0}
                    onClick={clearSelection}
                  >
                    {t('dashboard.bulk.clearSelection', { defaultValue: 'Clear selection' })}
                  </Button>
                </div>
              </div>
            )}

            {visibleSubmissions.length === 0 ? (
              pendingError && !submissionsLoading ? (
                <div className="rounded-lg bg-gray-50 dark:bg-gray-900/30 p-6 text-gray-700 dark:text-gray-300 shadow-sm">
                  <div className="font-semibold mb-1">{t('common.requestFailed', { defaultValue: 'Request failed' })}</div>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    {t('dashboard.failedToLoadPendingSubmissions', { defaultValue: 'Failed to load pending submissions.' })}
                  </p>
                  {onRetryPending ? (
                    <div className="mt-4">
                      <Button type="button" variant="secondary" onClick={onRetryPending}>
                        {t('common.retry', { defaultValue: 'Retry' })}
                      </Button>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="rounded-lg bg-gray-50 dark:bg-gray-900/30 p-6 text-gray-700 dark:text-gray-300 shadow-sm">
                  <div className="font-semibold mb-1">
                    {t('dashboard.noSubmissionsFound', { defaultValue: 'No submissions found.' })}
                  </div>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    {t('dashboard.noPendingSubmissionsHint', { defaultValue: 'New submissions will appear here automatically.' })}
                  </p>
                </div>
              )
            ) : (
              <ul className="space-y-4" role="list">
                {visibleSubmissions.map((submission) => (
                  <PendingSubmissionCard
                    key={submission.id}
                    submission={submission}
                    resolveMediaUrl={resolveMedia}
                    isFocused={focusedId === submission.id}
                    isSelected={selectedIds.includes(submission.id)}
                    onRequestFocus={() => setFocusedIndex(visibleIds.indexOf(submission.id))}
                    onToggleSelected={() => toggleSelection(submission.id)}
                    liRef={(el) => {
                      itemRefs.current[submission.id] = el;
                    }}
                    onOpenPreview={(data) => {
                      setPreviewModal({ open: true, src: data.src, title: data.title, submission });
                    }}
                    onApprove={onApprove}
                    onNeedsChanges={onNeedsChanges}
                    onReject={onReject}
                    helpEnabled={helpEnabled}
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
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-end gap-2">
              {helpEnabled ? (
                <Tooltip
                  delayMs={1000}
                  content={t('dashboard.help.refreshMySubmissions', {
                    defaultValue: 'Refresh the list of your submissions (use if the list looks outdated).',
                  })}
                >
                  <IconButton
                    type="button"
                    variant="secondary"
                    onClick={onRefreshMySubmissions}
                    disabled={mySubmissionsLoading}
                    aria-label={t('common.retry', { defaultValue: 'Повторить' })}
                    icon={<RefreshIcon spinning={mySubmissionsLoading} />}
                  />
                </Tooltip>
              ) : (
                <IconButton
                  type="button"
                  variant="secondary"
                  onClick={onRefreshMySubmissions}
                  disabled={mySubmissionsLoading}
                  aria-label={t('common.retry', { defaultValue: 'Повторить' })}
                  icon={<RefreshIcon spinning={mySubmissionsLoading} />}
                />
              )}

              {helpEnabled ? (
                <Tooltip
                  delayMs={1000}
                  content={t('dashboard.help.historyComingSoon', { defaultValue: 'Submission history will appear here later (coming soon).' })}
                >
                  <span className="inline-flex">
                    <IconButton
                      type="button"
                      variant="secondary"
                      disabled={true}
                      aria-label={t('dashboard.submissionsPanel.historyTab', { defaultValue: 'История' })}
                      icon={<HistoryIcon />}
                    />
                  </span>
                </Tooltip>
              ) : (
                <IconButton
                  type="button"
                  variant="secondary"
                  disabled={true}
                  aria-label={t('dashboard.submissionsPanel.historyTab', { defaultValue: 'История' })}
                  icon={<HistoryIcon />}
                />
              )}

              {helpEnabled ? (
                <Tooltip
                  delayMs={1000}
                  content={t('dashboard.help.channelTabComingSoon', {
                    defaultValue: 'A dedicated “channel submissions” view will appear here later (coming soon).',
                  })}
                >
                  <span className="inline-flex">
                    <IconButton
                      type="button"
                      variant="secondary"
                      disabled={true}
                      aria-label={t('dashboard.submissionsPanel.channelTab', { defaultValue: 'Заявки канала' })}
                      icon={<ChannelIcon />}
                    />
                  </span>
                </Tooltip>
              ) : (
                <IconButton
                  type="button"
                  variant="secondary"
                  disabled={true}
                  aria-label={t('dashboard.submissionsPanel.channelTab', { defaultValue: 'Заявки канала' })}
                  icon={<ChannelIcon />}
                />
              )}
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
        onClose={() => setPreviewModal({ open: false, src: '', title: '', submission: null })}
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
              onClick={() => setPreviewModal({ open: false, src: '', title: '', submission: null })}
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

          {(() => {
            const s = previewModal.submission;
            if (!s) return null;
            const aiStatus = s.aiStatus ?? null;
            const aiAutoTags = Array.isArray(s.aiAutoTagNamesJson) ? s.aiAutoTagNamesJson.filter((x) => typeof x === 'string') : [];
            const aiAutoDescription = typeof s.aiAutoDescription === 'string' ? s.aiAutoDescription : '';
            const canSeeAiDescription = canViewSubmissionAiDescription(user);
            const showProcessing = aiStatus && aiStatus !== 'done' && aiAutoTags.length === 0 && !aiAutoDescription;

            if (!aiStatus && aiAutoTags.length === 0 && !aiAutoDescription) return null;

            return (
              <section className="mt-4 rounded-xl bg-black/5 dark:bg-white/5 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-bold text-gray-900 dark:text-white">AI</div>
                  {aiStatus ? <Pill variant={aiStatus === 'done' ? 'success' : aiStatus === 'failed' || aiStatus === 'failed_final' ? 'danger' : 'primary'} size="sm">AI {aiStatus}</Pill> : null}
                </div>

                {showProcessing ? (
                  <div className="mt-2 text-sm text-gray-700 dark:text-gray-300">
                    {t('submissions.aiProcessing', { defaultValue: 'AI: в обработке…' })}
                  </div>
                ) : null}

                {aiAutoTags.length > 0 ? (
                  <div className="mt-3">
                    <div className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                      {t('submissions.aiAutoTags', { defaultValue: 'AI теги' })}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {aiAutoTags.slice(0, 40).map((tag) => (
                        <Pill key={tag} variant="primary" size="sm">
                          {tag}
                        </Pill>
                      ))}
                      {aiAutoTags.length > 40 ? <Pill variant="neutral" size="sm">+{aiAutoTags.length - 40}</Pill> : null}
                    </div>
                  </div>
                ) : null}

                {aiAutoDescription && canSeeAiDescription ? (
                  <div className="mt-3">
                    <div className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                      {t('submissions.aiAutoDescription', { defaultValue: 'AI описание' })}
                    </div>
                    <div className="mt-1 text-sm text-gray-700 dark:text-gray-200 whitespace-pre-wrap">{aiAutoDescription}</div>
                  </div>
                ) : null}
              </section>
            );
          })()}
        </div>
      </Modal>
    </section>
  );
}
