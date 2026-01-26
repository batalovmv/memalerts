import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { SubmissionsPanelTab } from '@/features/dashboard/ui/panels/submissions/model/types';
import type { Submission } from '@memalerts/api-contracts';

import { useLoadMoreOnIntersect } from '@/features/dashboard/ui/panels/pending-submissions/model/useLoadMoreOnIntersect';

type UsePendingSubmissionsPanelStateParams = {
  isOpen: boolean;
  activeTab: SubmissionsPanelTab;
  submissions: Submission[];
  submissionsLoading: boolean;
  submissionsLoadingMore: boolean;
  total: number | null;
  onLoadMorePending: () => void;
};

export function usePendingSubmissionsPanelState({
  isOpen,
  activeTab,
  submissions,
  submissionsLoading,
  submissionsLoadingMore,
  total,
  onLoadMorePending,
}: UsePendingSubmissionsPanelStateParams) {
  const [focusedIndex, setFocusedIndex] = useState<number>(-1);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const itemRefs = useRef<Record<string, HTMLLIElement | null>>({});
  const previewToggleRef = useRef<Record<string, () => void>>({});
  const selectAllRef = useRef<HTMLInputElement | null>(null);

  const visibleSubmissions = useMemo(() => submissions, [submissions]);
  const visibleIds = useMemo(() => visibleSubmissions.map((s) => s.id), [visibleSubmissions]);
  const hasMorePending = typeof total === 'number' ? visibleSubmissions.length < total : true;
  const focusedSubmission = focusedIndex >= 0 ? visibleSubmissions[focusedIndex] : null;
  const focusedId = focusedSubmission?.id ?? null;

  const loadMoreRef = useLoadMoreOnIntersect({
    enabled: isOpen && activeTab === 'pending',
    hasMore: hasMorePending,
    isLoading: submissionsLoading || submissionsLoadingMore,
    onLoadMore: onLoadMorePending,
    rootMargin: '400px 0px',
  });

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

  const toggleSelection = useCallback((id: string | null) => {
    if (!id) return;
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }, []);

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

  const registerPreviewToggle = useCallback((id: string, handler: (() => void) | null) => {
    if (handler) {
      previewToggleRef.current[id] = handler;
    } else {
      delete previewToggleRef.current[id];
    }
  }, []);

  const togglePreview = useCallback((id: string | null) => {
    if (!id) return;
    previewToggleRef.current[id]?.();
  }, []);

  const registerItemRef = useCallback((id: string, el: HTMLLIElement | null) => {
    itemRefs.current[id] = el;
  }, []);

  return {
    allVisibleSelected,
    clearSelection,
    focusedId,
    focusedIndex,
    hasMorePending,
    loadMoreRef,
    moveFocus,
    registerItemRef,
    registerPreviewToggle,
    selectAllRef,
    selectedIds,
    setFocusedIndex,
    setSelectedIds,
    someVisibleSelected,
    toggleAllVisible,
    togglePreview,
    toggleSelection,
    visibleIds,
    visibleSubmissions,
  };
}

