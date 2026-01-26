import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import type { PendingFilters, SubmissionsPanelTab } from '@/features/dashboard/ui/panels/submissions/model/types';
import type { MySubmission } from '@/features/submit/types';
import type { Submission } from '@memalerts/api-contracts';

import { useMySubmissionsList } from '@/features/dashboard/ui/panels/submissions/model/useMySubmissionsList';
import { usePendingHotkeys } from '@/features/dashboard/ui/panels/submissions/model/usePendingHotkeys';
import { usePendingSubmissionsPanelState } from '@/features/dashboard/ui/panels/submissions/model/usePendingSubmissionsPanelState';
import { useSubmissionPreviewModal } from '@/features/dashboard/ui/panels/submissions/model/useSubmissionPreviewModal';
import { MySubmissionsList } from '@/features/dashboard/ui/panels/submissions/ui/MySubmissionsList';
import { MySubmissionsToolbar } from '@/features/dashboard/ui/panels/submissions/ui/MySubmissionsToolbar';
import { PendingSubmissionsEmptyState } from '@/features/dashboard/ui/panels/submissions/ui/PendingSubmissionsEmptyState';
import { PendingSubmissionsFilters } from '@/features/dashboard/ui/panels/submissions/ui/PendingSubmissionsFilters';
import { PendingSubmissionsList } from '@/features/dashboard/ui/panels/submissions/ui/PendingSubmissionsList';
import { SubmissionPreviewModal } from '@/features/dashboard/ui/panels/submissions/ui/SubmissionPreviewModal';
import { SubmissionsPanelHeader } from '@/features/dashboard/ui/panels/submissions/ui/SubmissionsPanelHeader';
import { resolveMediaUrl } from '@/lib/urls';
import { getRuntimeConfig } from '@/shared/config/runtimeConfig';
import { cn } from '@/shared/lib/cn';
import { useAppSelector } from '@/store/hooks';

export type { SubmissionsPanelTab } from '@/features/dashboard/ui/panels/submissions/model/types';

export type DashboardSubmissionsPanelProps = {
  isOpen: boolean;
  activeTab: SubmissionsPanelTab;
  onTabChange: (tab: SubmissionsPanelTab) => void;
  helpEnabled?: boolean;

  submissions: Submission[];
  submissionsLoading: boolean;
  submissionsLoadingMore: boolean;
  pendingError?: string | null;
  pendingCount: number;
  total: number | null;
  pendingFilters: PendingFilters;
  onPendingFiltersChange: (next: PendingFilters) => void;
  onLoadMorePending: () => void;
  onRetryPending?: () => void;
  onApprove: (submissionId: string) => void;
  onNeedsChanges: (submissionId: string) => void;
  onReject: (submissionId: string) => void;
  onBulkAction?: (action: 'approve' | 'reject' | 'needs_changes', submissionIds: string[]) => void;

  mySubmissions: MySubmission[];
  mySubmissionsLoading: boolean;
  onRefreshMySubmissions: () => void;

  onClose: () => void;
};

export const DashboardSubmissionsPanel = memo(function DashboardSubmissionsPanel({
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
  const aiEnabled = getRuntimeConfig()?.aiEnabled !== false;

  const {
    allVisibleSelected,
    clearSelection,
    focusedId,
    loadMoreRef,
    moveFocus,
    registerItemRef,
    registerPreviewToggle,
    selectAllRef,
    selectedIds,
    setFocusedIndex,
    toggleAllVisible,
    togglePreview,
    toggleSelection,
    visibleIds,
    visibleSubmissions,
  } = usePendingSubmissionsPanelState({
    isOpen,
    activeTab,
    submissions,
    submissionsLoading,
    submissionsLoadingMore,
    total,
    onLoadMorePending,
  });

  const { myCount, mySorted } = useMySubmissionsList(mySubmissions);
  const { previewModal, openPreview, closePreview } = useSubmissionPreviewModal();

  const handleRequestFocus = useCallback(
    (id: string) => {
      setFocusedIndex(visibleIds.indexOf(id));
    },
    [setFocusedIndex, visibleIds],
  );

  const handleOpenPreview = useCallback(
    (data: { src: string; title: string; submission: Submission }) => {
      openPreview(data);
    },
    [openPreview],
  );

  usePendingHotkeys({
    activeTab,
    enabled: isOpen,
    focusedId,
    previewModalOpen: previewModal.open,
    onApprove,
    onReject,
    onNeedsChanges,
    onMoveFocus: moveFocus,
    onClearSelection: clearSelection,
    onClosePreview: closePreview,
    onTogglePreview: togglePreview,
  });

  const hasPending = visibleSubmissions.length > 0;
  const showPendingList = activeTab === 'pending';
  const showMineList = activeTab === 'mine';

  return (
    <section
      className={cn(isOpen ? 'block' : 'hidden', 'surface max-w-6xl mx-auto')}
      aria-label={t('dashboard.submissionsPanel.title', { defaultValue: 'Submissions' })}
    >
      <SubmissionsPanelHeader
        activeTab={activeTab}
        pendingCount={pendingCount}
        myCount={myCount}
        submissionsLoading={submissionsLoading}
        mySubmissionsLoading={mySubmissionsLoading}
        onTabChange={onTabChange}
        onClose={onClose}
      />

      <div className="surface-body max-h-[70vh] overflow-y-auto">
        {showPendingList ? (
          <div className="space-y-4">
            <PendingSubmissionsFilters aiEnabled={aiEnabled} filters={pendingFilters} onChange={onPendingFiltersChange} />

            {!hasPending ? (
              <PendingSubmissionsEmptyState
                pendingError={pendingError}
                submissionsLoading={submissionsLoading}
                onRetryPending={onRetryPending}
              />
            ) : (
              <PendingSubmissionsList
                submissions={visibleSubmissions}
                focusedId={focusedId}
                selectedIds={selectedIds}
                allVisibleSelected={allVisibleSelected}
                selectAllRef={selectAllRef}
                onToggleAllVisible={toggleAllVisible}
                onBulkAction={onBulkAction}
                onClearSelection={clearSelection}
                onRegisterPreviewToggle={registerPreviewToggle}
                onRequestFocus={handleRequestFocus}
                onToggleSelected={toggleSelection}
                onRegisterItemRef={registerItemRef}
                onOpenPreview={handleOpenPreview}
                onApprove={onApprove}
                onNeedsChanges={onNeedsChanges}
                onReject={onReject}
                helpEnabled={helpEnabled}
                loadMoreRef={loadMoreRef}
                submissionsLoadingMore={submissionsLoadingMore}
                resolveMediaUrl={resolveMediaUrl}
              />
            )}
          </div>
        ) : null}

        {showMineList ? (
          <div className="space-y-4">
            <MySubmissionsToolbar
              helpEnabled={helpEnabled}
              mySubmissionsLoading={mySubmissionsLoading}
              onRefreshMySubmissions={onRefreshMySubmissions}
            />
            <MySubmissionsList
              mySubmissionsLoading={mySubmissionsLoading}
              mySorted={mySorted}
              onRefreshMySubmissions={onRefreshMySubmissions}
            />
          </div>
        ) : null}
      </div>

      <SubmissionPreviewModal aiEnabled={aiEnabled} previewModal={previewModal} user={user} onClose={closePreview} />
    </section>
  );
});

