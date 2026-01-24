import { useCallback } from 'react';

import type { SubmissionsPanelTab } from '@/features/dashboard/ui/panels/submissions/model/types';

import { useHotkeys } from '@/shared/lib/hooks';

type UsePendingHotkeysParams = {
  activeTab: SubmissionsPanelTab;
  enabled: boolean;
  focusedId: string | null;
  previewModalOpen: boolean;
  onApprove: (submissionId: string) => void;
  onReject: (submissionId: string) => void;
  onNeedsChanges: (submissionId: string) => void;
  onMoveFocus: (delta: number) => void;
  onClearSelection: () => void;
  onClosePreview: () => void;
  onTogglePreview: (id: string | null) => void;
};

export function usePendingHotkeys({
  activeTab,
  enabled,
  focusedId,
  previewModalOpen,
  onApprove,
  onReject,
  onNeedsChanges,
  onMoveFocus,
  onClearSelection,
  onClosePreview,
  onTogglePreview,
}: UsePendingHotkeysParams) {
  const handleKey = useCallback(
    (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toUpperCase() || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) return;

      const key = e.key;
      if (key === 'Enter') {
        if (focusedId) onApprove(focusedId);
        return;
      }
      if (key === 'Backspace' || key === 'Delete') {
        if (focusedId) {
          e.preventDefault();
          onReject(focusedId);
        }
        return;
      }
      if (key.toLowerCase() === 'n') {
        if (focusedId) onNeedsChanges(focusedId);
        return;
      }
      if (key === 'ArrowLeft' || key === 'ArrowUp') {
        onMoveFocus(-1);
        return;
      }
      if (key === 'ArrowRight' || key === 'ArrowDown') {
        onMoveFocus(1);
        return;
      }
      if (key === ' ') {
        e.preventDefault();
        onTogglePreview(focusedId);
        return;
      }
      if (key === 'Escape') {
        if (previewModalOpen) {
          onClosePreview();
        } else {
          onClearSelection();
        }
      }
    },
    [
      focusedId,
      onApprove,
      onClearSelection,
      onClosePreview,
      onMoveFocus,
      onNeedsChanges,
      onReject,
      onTogglePreview,
      previewModalOpen,
    ],
  );

  useHotkeys(handleKey, [handleKey, focusedId], enabled && activeTab === 'pending');
}
