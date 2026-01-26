import { useTranslation } from 'react-i18next';

import type { Submission } from '@memalerts/api-contracts';
import type { RefObject } from 'react';

import { PendingSubmissionCard } from '@/features/dashboard/ui/panels/pending-submissions/PendingSubmissionCard';
import { BulkModerationBar } from '@/features/dashboard/ui/panels/submissions/BulkModerationBar';
import { Spinner } from '@/shared/ui';

type PendingSubmissionsListProps = {
  submissions: Submission[];
  focusedId: string | null;
  selectedIds: string[];
  allVisibleSelected: boolean;
  selectAllRef: RefObject<HTMLInputElement>;
  onToggleAllVisible: (checked: boolean) => void;
  onBulkAction?: (action: 'approve' | 'reject' | 'needs_changes', submissionIds: string[]) => void;
  onClearSelection: () => void;
  onRegisterPreviewToggle: (id: string, handler: (() => void) | null) => void;
  onRequestFocus: (id: string) => void;
  onToggleSelected: (id: string) => void;
  onRegisterItemRef: (id: string, el: HTMLLIElement | null) => void;
  onOpenPreview: (data: { src: string; title: string; submission: Submission }) => void;
  onApprove: (submissionId: string) => void;
  onNeedsChanges: (submissionId: string) => void;
  onReject: (submissionId: string) => void;
  helpEnabled?: boolean;
  loadMoreRef: RefObject<HTMLLIElement>;
  submissionsLoadingMore: boolean;
  resolveMediaUrl: (src: string) => string;
};

export function PendingSubmissionsList({
  submissions,
  focusedId,
  selectedIds,
  allVisibleSelected,
  selectAllRef,
  onToggleAllVisible,
  onBulkAction,
  onClearSelection,
  onRegisterPreviewToggle,
  onRequestFocus,
  onToggleSelected,
  onRegisterItemRef,
  onOpenPreview,
  onApprove,
  onNeedsChanges,
  onReject,
  helpEnabled,
  loadMoreRef,
  submissionsLoadingMore,
  resolveMediaUrl,
}: PendingSubmissionsListProps) {
  const { t } = useTranslation();

  return (
    <>
      {submissions.length > 0 ? (
        <BulkModerationBar
          selectAllRef={selectAllRef}
          allVisibleSelected={allVisibleSelected}
          selectedIds={selectedIds}
          onToggleAllVisible={onToggleAllVisible}
          onBulkAction={onBulkAction}
          onClearSelection={onClearSelection}
        />
      ) : null}

      <ul className="space-y-4" role="list">
        {submissions.map((submission) => (
          <PendingSubmissionCard
            key={submission.id}
            submission={submission}
            resolveMediaUrl={resolveMediaUrl}
            isFocused={focusedId === submission.id}
            isSelected={selectedIds.includes(submission.id)}
            onRegisterPreviewToggle={onRegisterPreviewToggle}
            onRequestFocus={() => onRequestFocus(submission.id)}
            onToggleSelected={() => onToggleSelected(submission.id)}
            liRef={(el) => onRegisterItemRef(submission.id, el)}
            onOpenPreview={(data) => onOpenPreview({ ...data, submission })}
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
    </>
  );
}

