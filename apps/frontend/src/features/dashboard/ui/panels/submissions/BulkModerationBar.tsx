import { useTranslation } from 'react-i18next';

import type { RefObject } from 'react';

import { Button } from '@/shared/ui';

export type BulkModerationBarProps = {
  selectAllRef: RefObject<HTMLInputElement>;
  allVisibleSelected: boolean;
  selectedIds: string[];
  onToggleAllVisible: (checked: boolean) => void;
  onBulkAction?: (action: 'approve' | 'reject' | 'needs_changes', submissionIds: string[]) => void;
  onClearSelection: () => void;
};

export function BulkModerationBar({
  selectAllRef,
  allVisibleSelected,
  selectedIds,
  onToggleAllVisible,
  onBulkAction,
  onClearSelection,
}: BulkModerationBarProps) {
  const { t } = useTranslation();
  const selectionCount = selectedIds.length;
  const actionsDisabled = selectionCount === 0 || !onBulkAction;

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-black/5 dark:bg-white/5 p-3">
      <label className="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
        <input
          ref={selectAllRef}
          type="checkbox"
          className="h-4 w-4 rounded border-black/10 dark:border-white/15 bg-white/50 dark:bg-white/10 text-primary focus:ring-2 focus:ring-primary/30"
          checked={allVisibleSelected}
          aria-label={t('dashboard.bulk.selectAll', { defaultValue: 'Select all' })}
          onChange={(e) => onToggleAllVisible(e.target.checked)}
        />
        <span>{t('dashboard.bulk.selectAll', { defaultValue: 'Select all' })}</span>
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {t('dashboard.bulk.selectedCount', { defaultValue: 'Selected: {{count}}', count: selectionCount })}
        </span>
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="success"
          size="sm"
          disabled={actionsDisabled}
          onClick={() => onBulkAction?.('approve', selectedIds)}
        >
          {t('dashboard.bulk.approveSelected', { defaultValue: 'Approve selected' })}
        </Button>
        <Button
          type="button"
          variant="warning"
          size="sm"
          disabled={actionsDisabled}
          onClick={() => onBulkAction?.('needs_changes', selectedIds)}
        >
          {t('dashboard.bulk.needsChangesSelected', { defaultValue: 'Needs changes' })}
        </Button>
        <Button
          type="button"
          variant="danger"
          size="sm"
          disabled={actionsDisabled}
          onClick={() => onBulkAction?.('reject', selectedIds)}
        >
          {t('dashboard.bulk.rejectSelected', { defaultValue: 'Reject selected' })}
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={selectionCount === 0}
          onClick={onClearSelection}
        >
          {t('dashboard.bulk.clearSelection', { defaultValue: 'Clear selection' })}
        </Button>
      </div>
    </div>
  );
}
