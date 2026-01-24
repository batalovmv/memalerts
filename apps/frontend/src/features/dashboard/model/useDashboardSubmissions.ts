import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { User } from '@/types';

import { useDebounce } from '@/shared/lib/hooks';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { fetchSubmissions } from '@/store/slices/submissionsSlice';

type PendingStatusFilter = 'all' | 'pending' | 'approved' | 'rejected';
type PendingAiStatusFilter = 'all' | 'pending' | 'processing' | 'done' | 'failed';
type PendingSortOrder = 'newest-first' | 'oldest-first';

type PendingFilters = {
  status: PendingStatusFilter;
  aiStatus: PendingAiStatusFilter;
  q: string;
  sort: PendingSortOrder;
};

type UseDashboardSubmissionsOptions = {
  user: User | null | undefined;
};

const DEFAULT_FILTERS: PendingFilters = {
  status: 'all',
  aiStatus: 'all',
  q: '',
  sort: 'newest-first',
};

export function useDashboardSubmissions({ user }: UseDashboardSubmissionsOptions) {
  const dispatch = useAppDispatch();
  const {
    submissions,
    loading: submissionsLoading,
    loadingMore: submissionsLoadingMore,
    total: submissionsTotal,
    error: submissionsError,
    lastFetchedAt: submissionsLastFetchedAt,
    lastErrorAt: submissionsLastErrorAt,
  } = useAppSelector((state) => state.submissions);
  const [pendingFilters, setPendingFilters] = useState<PendingFilters>(DEFAULT_FILTERS);
  const debouncedPendingQ = useDebounce(pendingFilters.q, 300);
  const pendingFiltersKeyRef = useRef('');
  const submissionsLoadedRef = useRef(false);

  const refreshPending = useCallback(
    ({ includeTotal = true }: { includeTotal?: boolean } = {}) => {
      dispatch(
        fetchSubmissions({
          status: pendingFilters.status,
          aiStatus: pendingFilters.aiStatus,
          q: debouncedPendingQ.trim() || undefined,
          sort: pendingFilters.sort,
          limit: 20,
          offset: 0,
          includeTotal,
        }),
      );
    },
    [debouncedPendingQ, dispatch, pendingFilters.aiStatus, pendingFilters.sort, pendingFilters.status],
  );

  const loadMorePending = useCallback(() => {
    const offset = submissions.length;
    if (typeof submissionsTotal === 'number' && offset >= submissionsTotal) return;
    dispatch(
      fetchSubmissions({
        status: pendingFilters.status,
        aiStatus: pendingFilters.aiStatus,
        q: debouncedPendingQ.trim() || undefined,
        sort: pendingFilters.sort,
        limit: 20,
        offset,
      }),
    );
  }, [debouncedPendingQ, dispatch, pendingFilters.aiStatus, pendingFilters.sort, pendingFilters.status, submissions.length, submissionsTotal]);

  const retryPending = useCallback(() => {
    refreshPending({ includeTotal: true });
  }, [refreshPending]);

  useEffect(() => {
    const userId = user?.id;
    const userRole = user?.role;
    const userChannelId = user?.channelId;

    if (userId && (userRole === 'streamer' || userRole === 'admin') && userChannelId) {
      const SUBMISSIONS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
      const ERROR_RETRY_DELAY = 5 * 60 * 1000; // 5 minutes before retrying after error
      const trimmedQ = debouncedPendingQ.trim();
      const nextFiltersKey = [pendingFilters.status, pendingFilters.aiStatus, trimmedQ, pendingFilters.sort].join('|');
      const filtersChanged = pendingFiltersKeyRef.current !== nextFiltersKey;
      if (filtersChanged) {
        pendingFiltersKeyRef.current = nextFiltersKey;
        submissionsLoadedRef.current = false;
      }

      const hasFreshData =
        submissions.length > 0 &&
        submissionsLastFetchedAt !== null &&
        (Date.now() - submissionsLastFetchedAt) < SUBMISSIONS_CACHE_TTL;
      const hasRecentError =
        submissionsLastErrorAt !== null &&
        (Date.now() - submissionsLastErrorAt) < ERROR_RETRY_DELAY;
      const shouldBlockForError = hasRecentError && !filtersChanged;

      if ((filtersChanged || !hasFreshData) && !submissionsLoading && !shouldBlockForError && !submissionsLoadedRef.current) {
        submissionsLoadedRef.current = true;
        refreshPending({ includeTotal: true });
      } else if (hasFreshData && !filtersChanged) {
        submissionsLoadedRef.current = true;
      }
    }

    if (!userId || !userChannelId) {
      submissionsLoadedRef.current = false;
      pendingFiltersKeyRef.current = '';
    }
  }, [
    debouncedPendingQ,
    pendingFilters.aiStatus,
    pendingFilters.sort,
    pendingFilters.status,
    refreshPending,
    submissions.length,
    submissionsLastErrorAt,
    submissionsLastFetchedAt,
    submissionsLoading,
    user?.channelId,
    user?.id,
    user?.role,
  ]);

  const pendingSubmissionsCount = useMemo(() => {
    return pendingFilters.status === 'pending' && typeof submissionsTotal === 'number'
      ? submissionsTotal
      : submissions.filter((s) => s.status === 'pending').length;
  }, [pendingFilters.status, submissions, submissionsTotal]);

  return {
    submissions,
    submissionsLoading,
    submissionsLoadingMore,
    submissionsTotal,
    submissionsError,
    pendingFilters,
    setPendingFilters,
    pendingSubmissionsCount,
    loadMorePending,
    retryPending,
    refreshPending,
  };
}
