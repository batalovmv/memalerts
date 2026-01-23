import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from '@/lib/api';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { store } from '@/store/index';
import { selectPendingSubmissionsCount } from '@/store/selectors';
import { fetchSubmissions } from '@/store/slices/submissionsSlice';

export function useHeaderSubmissions() {
  const { user } = useAppSelector((state) => state.auth);
  const { submissions, loading: submissionsLoading } = useAppSelector((state) => state.submissions);
  const pendingSubmissionsCount = useAppSelector(selectPendingSubmissionsCount);
  const dispatch = useAppDispatch();

  const submissionsLoadedRef = useRef(false);

  // Viewer-side "needs changes" submissions (my submissions that require edits)
  const [myNeedsChangesCount, setMyNeedsChangesCount] = useState(0);
  const [mySubmissionsLoading, setMySubmissionsLoading] = useState(false);
  const lastMySubmissionsFetchAtRef = useRef<number>(0);
  const mySubmissionsFetchInFlightRef = useRef(false);

  const loadMyNeedsChangesCount = useCallback(
    async (opts?: { force?: boolean }) => {
      const userId = user?.id;
      if (!userId) {
        setMyNeedsChangesCount(0);
        setMySubmissionsLoading(false);
        lastMySubmissionsFetchAtRef.current = 0;
        return;
      }

      const ttlMs = 30_000;
      const now = Date.now();
      if (!opts?.force && now - lastMySubmissionsFetchAtRef.current < ttlMs) return;
      if (mySubmissionsFetchInFlightRef.current) return;

      mySubmissionsFetchInFlightRef.current = true;
      setMySubmissionsLoading(true);
      try {
        const data = await api.get<unknown>('/submissions', { params: { status: 'needs_changes' }, timeout: 10000 });
        setMyNeedsChangesCount(Array.isArray(data) ? data.length : 0);
        lastMySubmissionsFetchAtRef.current = Date.now();
      } catch {
        setMyNeedsChangesCount(0);
        lastMySubmissionsFetchAtRef.current = Date.now();
      } finally {
        setMySubmissionsLoading(false);
        mySubmissionsFetchInFlightRef.current = false;
      }
    },
    [user?.id],
  );

  // Load submissions for streamer/admin if not already loaded
  useEffect(() => {
    const userId = user?.id;
    const userRole = user?.role;
    const userChannelId = user?.channelId;

    if (userId && (userRole === 'streamer' || userRole === 'admin') && userChannelId) {
      const currentState = store.getState();
      const submissionsState = currentState.submissions;
      const SUBMISSIONS_CACHE_TTL = 5 * 60 * 1000;
      const ERROR_RETRY_DELAY = 5 * 60 * 1000;

      const hasFreshData =
        submissionsState.submissions.length > 0 &&
        submissionsState.lastFetchedAt !== null &&
        Date.now() - submissionsState.lastFetchedAt < SUBMISSIONS_CACHE_TTL;

      const hasRecentError =
        submissionsState.lastErrorAt !== null && Date.now() - submissionsState.lastErrorAt < ERROR_RETRY_DELAY;

      const isLoading = submissionsState.loading;

      if (!hasFreshData && !isLoading && !hasRecentError && !submissionsLoadedRef.current) {
        submissionsLoadedRef.current = true;
        dispatch(fetchSubmissions({ status: 'pending' }));
      } else if (hasFreshData) {
        submissionsLoadedRef.current = true;
      }
    }

    if (!userId || !userChannelId) {
      submissionsLoadedRef.current = false;
    }
  }, [user?.id, user?.role, user?.channelId, dispatch]);

  // Load viewer-side "needs changes" count with TTL + refresh on focus/visibility and after local resubmits.
  useEffect(() => {
    void loadMyNeedsChangesCount({ force: true });

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void loadMyNeedsChangesCount();
      }
    };
    const onFocus = () => void loadMyNeedsChangesCount();
    const onMySubmissionsUpdated = () => void loadMyNeedsChangesCount({ force: true });

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onFocus);
    window.addEventListener('my-submissions:updated', onMySubmissionsUpdated as EventListener);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('my-submissions:updated', onMySubmissionsUpdated as EventListener);
    };
  }, [loadMyNeedsChangesCount]);

  return {
    pendingCount: pendingSubmissionsCount,
    submissionsLoading,
    submissionsCount: submissions.length,
    needsChangesCount: myNeedsChangesCount,
    mySubmissionsLoading,
  };
}
