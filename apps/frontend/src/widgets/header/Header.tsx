import { Suspense, lazy, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';

import type { Wallet } from '@/types';

import UserMenu from '@/components/UserMenu';
import { useChannelColors } from '@/contexts/ChannelColorsContext';
import { useSocket } from '@/contexts/SocketContext';
import { api } from '@/lib/api';
import { login } from '@/lib/auth';
import { getEffectiveUserMode } from '@/shared/lib/uiMode';
import { Button, HelpTooltip, Pill } from '@/shared/ui';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { store } from '@/store/index';
import { selectPendingSubmissionsCount } from '@/store/selectors';
import { updateWalletBalance } from '@/store/slices/authSlice';
import {
  fetchSubmissions,
  submissionApproved,
  submissionCreated,
  submissionNeedsChanges,
  submissionRejected,
  submissionResubmitted,
} from '@/store/slices/submissionsSlice';

const SubmitModal = lazy(() => import('@/components/SubmitModal'));
const AuthRequiredModal = lazy(() => import('@/components/AuthRequiredModal'));

export interface HeaderProps {
  channelSlug?: string;
  channelId?: string;
  primaryColor?: string | null;
  coinIconUrl?: string | null;
  rewardTitle?: string | null;
}

// (helper removed) needs-changes count is fetched directly from backend via ?status=needs_changes

export default function Header({ channelSlug, channelId, primaryColor, coinIconUrl, rewardTitle }: HeaderProps) {
  const { t } = useTranslation();
  const { user } = useAppSelector((state) => state.auth);
  const uiMode = getEffectiveUserMode(user);
  const userId = user?.id;
  const userChannelId = user?.channelId;
  const userChannelSlug = user?.channel?.slug;
  const userWallets = user?.wallets;
  const { submissions, loading: submissionsLoading } = useAppSelector((state) => state.submissions);
  const pendingSubmissionsCount = useAppSelector(selectPendingSubmissionsCount);
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams<{ slug: string }>();
  const { getChannelData, getCachedChannelData } = useChannelColors();
  const reactId = useId();
  const requestsMenuId = `header-requests-${reactId.replace(/:/g, '')}`;

  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [isSubmitModalOpen, setIsSubmitModalOpen] = useState(false);
  const [isLoadingWallet, setIsLoadingWallet] = useState(false);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [channelCoinIconUrl, setChannelCoinIconUrl] = useState<string | null>(null);
  const [channelRewardTitle, setChannelRewardTitle] = useState<string | null>(null);
  const { socket, isConnected } = useSocket();
  // Aggregated "coins gained" badge (avoid confusing "+100 (2)" UI; show the total delta instead).
  const [coinUpdateDelta, setCoinUpdateDelta] = useState<number | null>(null);
  const coinUpdateHideTimerRef = useRef<number | null>(null);
  const submissionsLoadedRef = useRef(false);
  const walletLoadedRef = useRef<string | null>(null); // Track which channel's wallet was loaded
  const channelDataLoadedRef = useRef<string | null>(null); // Track which channel's data was loaded
  const lastWalletFetchAtRef = useRef<number>(0);
  const walletFetchInFlightRef = useRef(false);

  // Viewer-side "needs changes" submissions (my submissions that require edits)
  const [myNeedsChangesCount, setMyNeedsChangesCount] = useState(0);
  const [mySubmissionsLoading, setMySubmissionsLoading] = useState(false);
  const lastMySubmissionsFetchAtRef = useRef<number>(0);
  const mySubmissionsFetchInFlightRef = useRef(false);

  // Requests bell popover when both streamer+viewer counters are present
  const [isRequestsMenuOpen, setIsRequestsMenuOpen] = useState(false);
  const requestsMenuRef = useRef<HTMLDivElement>(null);

  // Determine if we're on own profile page
  const isOwnProfile = user && channelId && user.channelId === channelId;
  const currentChannelSlug = channelSlug || params.slug;
  const effectiveModeratorChannelSlug = (currentChannelSlug || user?.channel?.slug || '').trim().toLowerCase();
  const effectiveModeratorChannelId = channelId || user?.channelId;

  // Determine if submit button should be shown
  // Show only on: /dashboard, /settings, or own profile
  // Hide on: other profiles (/channel/:slug where slug !== user.channel?.slug)
  const showSubmitButton =
    user &&
    (location.pathname === '/dashboard' || location.pathname.startsWith('/settings') || isOwnProfile);

  const requireAuth = () => setAuthModalOpen(true);

  const loadMyNeedsChangesCount = useCallback(
    async (opts?: { force?: boolean }) => {
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
        // Fast path: backend supports filtering by status and guarantees "only mine" for /submissions.
        const data = await api.get<unknown>('/submissions', { params: { status: 'needs_changes' }, timeout: 10000 });
        setMyNeedsChangesCount(Array.isArray(data) ? data.length : 0);
        lastMySubmissionsFetchAtRef.current = Date.now();
      } catch {
        // Best-effort: don't break header UI
        setMyNeedsChangesCount(0);
        lastMySubmissionsFetchAtRef.current = Date.now();
      } finally {
        setMySubmissionsLoading(false);
        mySubmissionsFetchInFlightRef.current = false;
      }
    },
    [userId],
  );

  // Load submissions for streamer/admin if not already loaded
  // Check Redux store with TTL to avoid duplicate requests on navigation
  useEffect(() => {
    const userId = user?.id;
    const userRole = user?.role;
    const userChannelId = user?.channelId;

    if (userId && (userRole === 'streamer' || userRole === 'admin') && userChannelId) {
      const currentState = store.getState();
      const submissionsState = currentState.submissions;
      const SUBMISSIONS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
      const ERROR_RETRY_DELAY = 5 * 60 * 1000; // 5 minutes before retrying after error

      // Check if we have fresh data based on timestamp
      const hasFreshData =
        submissionsState.submissions.length > 0 &&
        submissionsState.lastFetchedAt !== null &&
        Date.now() - submissionsState.lastFetchedAt < SUBMISSIONS_CACHE_TTL;

      // Check if we had a recent error (especially 403) - don't retry immediately
      const hasRecentError =
        submissionsState.lastErrorAt !== null && Date.now() - submissionsState.lastErrorAt < ERROR_RETRY_DELAY;

      const isLoading = submissionsState.loading;

      // Only fetch if no fresh data, not loading, no recent error, and not already loaded
      if (!hasFreshData && !isLoading && !hasRecentError && !submissionsLoadedRef.current) {
        submissionsLoadedRef.current = true;
        dispatch(fetchSubmissions({ status: 'pending' }));
      } else if (hasFreshData) {
        submissionsLoadedRef.current = true; // Mark as loaded even if we didn't fetch
      }
    }
    // Reset ref when user changes
    if (!userId || !userChannelId) {
      submissionsLoadedRef.current = false;
    }
  }, [user?.id, user?.role, user?.channelId, dispatch]); // Use user?.id instead of user to prevent unnecessary re-runs

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

  // Close requests popover on outside click
  useEffect(() => {
    if (!isRequestsMenuOpen) return;
    const onDown = (event: MouseEvent) => {
      const root = requestsMenuRef.current;
      if (!root) return;
      if (!root.contains(event.target as Node)) setIsRequestsMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [isRequestsMenuOpen]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (coinUpdateHideTimerRef.current) {
        window.clearTimeout(coinUpdateHideTimerRef.current);
        coinUpdateHideTimerRef.current = null;
      }
    };
  }, []);

  // Load wallet balance and auto-refresh
  // Skip wallet loading if we're on a channel page - wallet is loaded by StreamerProfile
  useEffect(() => {
    if (!userId) {
      setWallet(null);
      walletLoadedRef.current = null;
      return;
    }

    // Don't load wallet in Header if we're on a channel page - it's loaded by StreamerProfile
    const isChannelPage = location.pathname.startsWith('/channel/');
    if (isChannelPage) {
      // Use wallet from Redux store if available, or from user data
      if (channelId && userWallets) {
        const userWallet = userWallets.find((w) => w.channelId === channelId);
        if (userWallet) {
          setWallet(userWallet);
        }
      }
      walletLoadedRef.current = null; // Reset since we're not loading here
      return;
    }

    // Determine which channel's wallet to load
    const targetChannelSlug = currentChannelSlug || userChannelSlug;
    const targetChannelId = channelId || userChannelId;

    // Check if wallet exists in user.wallets first - use Redux store as primary source
    if (targetChannelId && userWallets) {
      const userWallet = userWallets.find((w) => w.channelId === targetChannelId);
      if (userWallet) {
        setWallet(userWallet);
        walletLoadedRef.current = targetChannelSlug || null;
        return; // Use wallet from Redux, don't fetch - Socket.IO will update it automatically
      }
    }

    // Skip if we've already loaded wallet for this channel
    if (walletLoadedRef.current === targetChannelSlug) {
      return;
    }

    // Only fetch if wallet not in Redux and not already loaded
    const loadWallet = async () => {
      // If we're connected, wallet updates come via realtime; avoid aggressive refreshes on focus/tab switches.
      const WALLET_REFRESH_TTL_MS = 30_000;
      const now = Date.now();
      if (walletFetchInFlightRef.current) return;
      if (now - lastWalletFetchAtRef.current < WALLET_REFRESH_TTL_MS) return;

      setIsLoadingWallet(true);
      walletFetchInFlightRef.current = true;
      lastWalletFetchAtRef.current = now;
      try {
        if (targetChannelSlug) {
          // Load wallet for the current channel via API (only if not in Redux)
          try {
            const wallet = await api.get<Wallet>(`/channels/${targetChannelSlug}/wallet`, {
              timeout: 10000,
            });
            setWallet(wallet);
            walletLoadedRef.current = targetChannelSlug || null; // Mark as loaded
            // Update Redux store if channelId matches
            if (targetChannelId && wallet.channelId === targetChannelId) {
              dispatch(updateWalletBalance({ channelId: targetChannelId, balance: wallet.balance }));
            }
          } catch (error: unknown) {
            const apiError = error as { response?: { status?: number }; code?: string };
            if (apiError.response?.status === 404 || apiError.code === 'ECONNABORTED') {
              // Wallet doesn't exist yet, set default
              if (targetChannelId) {
                setWallet({
                  id: '',
                  userId,
                  channelId: targetChannelId,
                  balance: 0,
                });
                walletLoadedRef.current = targetChannelSlug || null; // Mark as loaded (even if default)
              }
            }
            console.warn('Failed to load wallet:', error);
          }
        }
      } catch (error) {
        console.error('Error loading wallet:', error);
      } finally {
        setIsLoadingWallet(false);
        walletFetchInFlightRef.current = false;
      }
    };

    // Load immediately on mount or when channel changes
    void loadWallet();

    // Refresh when tab becomes visible (user returns to page)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && !isChannelPage) {
        void loadWallet();
      }
    };

    // Refresh when window regains focus
    const handleFocus = () => {
      if (!isChannelPage) {
        void loadWallet();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
    };
  }, [
    userId,
    userChannelId,
    userChannelSlug,
    userWallets,
    currentChannelSlug,
    channelId,
    dispatch,
    location.pathname,
    isConnected,
  ]);

  // Load channel coin icon and reward title if not provided via props
  useEffect(() => {
    const loadChannelData = async () => {
      // If coinIconUrl is provided via props, use it
      if (coinIconUrl !== undefined) {
        setChannelCoinIconUrl(coinIconUrl);
      }

      // If rewardTitle is provided via props, use it
      if (rewardTitle !== undefined) {
        setChannelRewardTitle(rewardTitle);
      }

      // If both are provided via props, we're done
      if (coinIconUrl !== undefined && rewardTitle !== undefined) {
        channelDataLoadedRef.current = 'props'; // Mark as loaded via props
        return;
      }

      // Otherwise, try to get from cache or fetch
      const slugToUse = user?.channel?.slug || currentChannelSlug;
      if (!slugToUse) {
        channelDataLoadedRef.current = null;
        return;
      }

      // Skip if already loaded for this channel
      if (channelDataLoadedRef.current === slugToUse) {
        return;
      }

      // Don't fetch if we're on a channel page - data will be loaded by StreamerProfile
      // This avoids unnecessary requests with includeMemes=false
      if (location.pathname.startsWith('/channel/')) {
        channelDataLoadedRef.current = null; // Reset since we're not loading here
        return;
      }

      // Check cache first
      const cached = getCachedChannelData(slugToUse);
      if (cached) {
        if (coinIconUrl === undefined && cached.coinIconUrl) {
          setChannelCoinIconUrl(cached.coinIconUrl);
        }
        if (rewardTitle === undefined && cached.rewardTitle) {
          setChannelRewardTitle(cached.rewardTitle);
        }
        // If we got both from cache, we're done
        if ((coinIconUrl !== undefined || cached.coinIconUrl) && (rewardTitle !== undefined || cached.rewardTitle)) {
          channelDataLoadedRef.current = slugToUse;
          return;
        }
      }

      // If not in cache and not on channel page, fetch it
      // getChannelData already uses includeMemes=false by default for performance
      const channelData = await getChannelData(slugToUse);
      if (channelData) {
        if (coinIconUrl === undefined && channelData.coinIconUrl) {
          setChannelCoinIconUrl(channelData.coinIconUrl);
        }
        if (rewardTitle === undefined && channelData.rewardTitle) {
          setChannelRewardTitle(channelData.rewardTitle);
        }
        channelDataLoadedRef.current = slugToUse;
      }
    };

    void loadChannelData();
  }, [
    coinIconUrl,
    rewardTitle,
    user?.channel?.slug,
    currentChannelSlug,
    getCachedChannelData,
    getChannelData,
    location.pathname,
  ]);

  // Setup Socket.IO listeners for real-time wallet updates
  // Socket connection is managed by SocketContext at app level
  useEffect(() => {
    if (!socket || !userId) {
      return;
    }

    const handleWalletUpdate = (data: {
      userId: string;
      channelId: string;
      balance: number;
      delta?: number;
      reason?: string;
    }) => {
      // Only update if it's for the current user and channel
      if (data.userId === userId && (channelId ? data.channelId === channelId : true)) {
        setWallet((prev) => {
          const prevBalance = prev?.channelId === data.channelId ? prev.balance : prev?.balance ?? 0;
          const delta = typeof data.delta === 'number' ? data.delta : data.balance - prevBalance;

          // Show a header badge when coins are added from Twitch reward
          if (delta > 0 && (data.reason === 'twitch_reward' || data.reason === undefined)) {
            setCoinUpdateDelta((prevDelta) => (prevDelta ?? 0) + delta);

            if (coinUpdateHideTimerRef.current) {
              window.clearTimeout(coinUpdateHideTimerRef.current);
            }
            coinUpdateHideTimerRef.current = window.setTimeout(() => {
              setCoinUpdateDelta(null);
              coinUpdateHideTimerRef.current = null;
            }, 8000);
          }

          if (prev && prev.channelId === data.channelId) {
            return { ...prev, balance: data.balance };
          }

          // If Header had no wallet yet (first-time wallet creation), set it
          return {
            id: '',
            userId,
            channelId: data.channelId,
            balance: data.balance,
          };
        });
      }
    };

    socket.on('wallet:updated', handleWalletUpdate);

    // Join user room if connected
    if (socket.connected) {
      socket.emit('join:user', userId);
    }

    return () => {
      socket.off('wallet:updated', handleWalletUpdate);
    };
  }, [socket, userId, channelId]);

  // Realtime pending submissions badge updates (no polling)
  useEffect(() => {
    const userId = user?.id;
    const userRole = user?.role;

    if (!socket || !userId || !(userRole === 'streamer' || userRole === 'admin')) {
      return;
    }

    let refreshTimer: number | null = null;
    const scheduleRefreshPending = () => {
      if (refreshTimer) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => {
        // Pull the first page so cards have fileUrlTemp + submitter info immediately
        dispatch(fetchSubmissions({ status: 'pending', limit: 20, offset: 0 }));
      }, 250);
    };

    const onCreated = (data: { submissionId: string; channelId: string; submitterId?: string }) => {
      // Only update if it's for current channel (when available)
      if (effectiveModeratorChannelId && data.channelId && data.channelId !== effectiveModeratorChannelId) return;
      dispatch(submissionCreated(data));
      scheduleRefreshPending();
    };

    const onApproved = (data: { submissionId: string; channelId: string }) => {
      if (effectiveModeratorChannelId && data.channelId && data.channelId !== effectiveModeratorChannelId) return;
      dispatch(submissionApproved({ submissionId: data.submissionId }));
    };

    const onRejected = (data: { submissionId: string; channelId: string }) => {
      if (effectiveModeratorChannelId && data.channelId && data.channelId !== effectiveModeratorChannelId) return;
      dispatch(submissionRejected({ submissionId: data.submissionId }));
    };

    const onNeedsChanges = (data: { submissionId: string; channelId: string }) => {
      if (effectiveModeratorChannelId && data.channelId && data.channelId !== effectiveModeratorChannelId) return;
      dispatch(submissionNeedsChanges({ submissionId: data.submissionId }));
    };

    const onResubmitted = (data: { submissionId: string; channelId: string; submitterId?: string }) => {
      if (effectiveModeratorChannelId && data.channelId && data.channelId !== effectiveModeratorChannelId) return;
      dispatch(submissionResubmitted(data));
      scheduleRefreshPending();
    };

    socket.on('submission:created', onCreated);
    socket.on('submission:approved', onApproved);
    socket.on('submission:rejected', onRejected);
    socket.on('submission:needs_changes', onNeedsChanges);
    socket.on('submission:resubmitted', onResubmitted);

    // Ensure moderators are in their channel room (needed on /dashboard and /settings too)
    if (isConnected && effectiveModeratorChannelSlug) {
      socket.emit('join:channel', effectiveModeratorChannelSlug);
    }

    return () => {
      if (refreshTimer) window.clearTimeout(refreshTimer);
      socket.off('submission:created', onCreated);
      socket.off('submission:approved', onApproved);
      socket.off('submission:rejected', onRejected);
      socket.off('submission:needs_changes', onNeedsChanges);
      socket.off('submission:resubmitted', onResubmitted);
    };
  }, [
    socket,
    isConnected,
    user?.id,
    user?.role,
    effectiveModeratorChannelId,
    effectiveModeratorChannelSlug,
    dispatch,
  ]);

  // Update channel room when currentChannelSlug changes
  useEffect(() => {
    if (!socket) return;
    if (isConnected && effectiveModeratorChannelSlug) {
      socket.emit('join:channel', effectiveModeratorChannelSlug);
    }
  }, [socket, isConnected, effectiveModeratorChannelSlug]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const panel = (params.get('panel') || '').toLowerCase();
    const tab = (params.get('tab') || '').toLowerCase();
    const pendingCount = submissions.filter((s) => s.status === 'pending').length;
    void pendingCount;
    void tab;
    void panel;
  }, [location.pathname, location.search, submissions, user?.role]);

  const handlePendingSubmissionsClick = () => {
    const params = new URLSearchParams(location.search);
    const currentPanel = (params.get('panel') || params.get('tab') || '').toLowerCase();
    const isOnDashboard = location.pathname.startsWith('/dashboard');
    const isOpen = isOnDashboard && currentPanel === 'submissions';

    // Canonical open state is `panel=submissions` (works even if Dashboard is already mounted).
    params.delete('tab');
    params.delete('panel');
    if (!isOpen) {
      params.set('panel', 'submissions');
    }
    const search = params.toString();
    navigate(search ? `/dashboard?${search}` : '/dashboard');
  };

  // Streamer/admin pending approvals
  const showPendingIndicator = Boolean(user && uiMode === 'streamer' && (user.role === 'streamer' || user.role === 'admin'));
  const hasPendingSubmissions = pendingSubmissionsCount > 0;
  // Viewer needs-changes (my submissions)
  const hasNeedsChanges = myNeedsChangesCount > 0;

  const showRequestsIndicator = Boolean(user) && (showPendingIndicator || hasNeedsChanges || mySubmissionsLoading);
  const requestsTotalCount = (showPendingIndicator ? pendingSubmissionsCount : 0) + myNeedsChangesCount;
  const isLoadingSubmissions = submissionsLoading && submissions.length === 0;
  // Remove add coin button - channel owners can activate memes for free
  const balance = wallet?.balance || 0;
  const isInfiniteBalance =
    !!user &&
    uiMode === 'streamer' &&
    (user.role === 'streamer' || user.role === 'admin') &&
    (location.pathname === '/dashboard' || location.pathname.startsWith('/settings') || isOwnProfile);

  // Use CSS variables for colors when on public channel page, fallback to inline styles for other pages
  const navStyle: React.CSSProperties = {
    backgroundColor: primaryColor && !document.documentElement.classList.contains('dark') ? primaryColor : undefined,
  };

  const logoStyle: React.CSSProperties = {
    color: primaryColor && !document.documentElement.classList.contains('dark') ? '#ffffff' : undefined,
  };

  const requestsTitle = useMemo(() => {
    if (!user) return '';
    if (showPendingIndicator && hasPendingSubmissions && hasNeedsChanges) {
      return t('header.submissionsSummary', {
        defaultValue: 'Pending: {{pending}}, needs changes: {{needsChanges}}',
        pending: pendingSubmissionsCount,
        needsChanges: myNeedsChangesCount,
      });
    }
    if (showPendingIndicator && hasPendingSubmissions) {
      return pendingSubmissionsCount === 1
        ? t('header.pendingSubmissions', { count: 1 })
        : t('header.pendingSubmissionsPlural', { count: pendingSubmissionsCount });
    }
    if (hasNeedsChanges) {
      return t('header.needsChangesSubmissions', {
        defaultValue: 'Needs changes: {{count}}',
        count: myNeedsChangesCount,
      });
    }
    if (mySubmissionsLoading) {
      return t('header.loadingSubmissions', { defaultValue: 'Loading submissions...' });
    }
    return t('header.noSubmissions', { defaultValue: 'No submissions' });
  }, [
    user,
    showPendingIndicator,
    hasPendingSubmissions,
    hasNeedsChanges,
    mySubmissionsLoading,
    t,
    pendingSubmissionsCount,
    myNeedsChangesCount,
  ]);

  return (
    <>
      <nav className="bg-white dark:bg-gray-800 shadow-sm channel-theme-nav" style={navStyle}>
        <div className="page-container">
          <div className="flex justify-between h-16 items-center gap-2 min-w-0">
            <h1
              className="text-lg sm:text-xl font-bold dark:text-white cursor-pointer channel-theme-logo truncate min-w-0"
              style={logoStyle}
            >
              <Link to="/" className="text-inherit">
                Mem Alerts
              </Link>
            </h1>

            {user ? (
              <div className="flex items-center gap-1 sm:gap-3 flex-shrink-0">
                {/* Requests Indicator (streamer approvals + viewer "needs changes") */}
                {showRequestsIndicator && (
                  <div className="relative" ref={requestsMenuRef}>
                    {(() => {
                      const btn = (
                        <button
                          type="button"
                          onClick={() => {
                            // If user is only a viewer (or has no pending), jump to /submit directly.
                            if (!showPendingIndicator || !hasPendingSubmissions) {
                              navigate('/submit?tab=needs_changes');
                              return;
                            }

                            // Streamer/admin with pending only: keep old behavior (dashboard panel).
                            if (!hasNeedsChanges) {
                              handlePendingSubmissionsClick();
                              return;
                            }

                            // Both: open a small chooser popover.
                            setIsRequestsMenuOpen((v) => !v);
                          }}
                          className={`relative p-2 rounded-lg transition-colors ${
                            requestsTotalCount > 0 ? 'hover:bg-gray-100 dark:hover:bg-gray-700' : 'opacity-60 hover:bg-gray-50 dark:hover:bg-gray-800'
                          }`}
                          aria-label={requestsTitle}
                          aria-haspopup={showPendingIndicator && hasPendingSubmissions && hasNeedsChanges ? 'menu' : undefined}
                          aria-expanded={showPendingIndicator && hasPendingSubmissions && hasNeedsChanges ? isRequestsMenuOpen : undefined}
                          aria-controls={showPendingIndicator && hasPendingSubmissions && hasNeedsChanges ? requestsMenuId : undefined}
                        >
                          <svg
                            className={`w-6 h-6 transition-colors ${
                              requestsTotalCount > 0 ? 'text-primary' : 'text-gray-400 dark:text-gray-500'
                            }`}
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
                            />
                          </svg>

                          {requestsTotalCount > 0 && !(isLoadingSubmissions && showPendingIndicator) && (
                            <Pill
                              variant="dangerSolid"
                              className="absolute -top-1 -right-1 w-5 h-5 p-0 text-[11px] font-bold leading-none"
                            >
                              {requestsTotalCount}
                            </Pill>
                          )}
                        </button>
                      );

                      return (
                        <HelpTooltip content={t('help.header.requests', { defaultValue: 'Your notifications: pending approvals and memes that need changes.' })}>
                          {btn}
                        </HelpTooltip>
                      );
                    })()}

                    {showPendingIndicator && hasPendingSubmissions && hasNeedsChanges && isRequestsMenuOpen && (
                      <div
                        id={requestsMenuId}
                        role="menu"
                        aria-label={t('header.submissionsMenu', { defaultValue: 'Submissions menu' })}
                        className="absolute right-0 mt-2 w-64 glass rounded-xl shadow-xl ring-1 ring-black/5 dark:ring-white/10 py-2 z-50"
                      >
                        <button
                          type="button"
                          role="menuitem"
                          className="w-full text-left px-4 py-2 text-sm text-gray-800 dark:text-gray-200 hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
                          onClick={() => {
                            setIsRequestsMenuOpen(false);
                            handlePendingSubmissionsClick();
                          }}
                        >
                          {t('header.pendingApprovals', { defaultValue: 'Pending approvals' })}{' '}
                          <span className="text-xs text-gray-500 dark:text-gray-400">({pendingSubmissionsCount})</span>
                        </button>

                        <button
                          type="button"
                          role="menuitem"
                          className="w-full text-left px-4 py-2 text-sm text-gray-800 dark:text-gray-200 hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
                          onClick={() => {
                            setIsRequestsMenuOpen(false);
                            navigate('/submit?tab=needs_changes');
                          }}
                        >
                          {t('header.needsChanges', { defaultValue: 'Needs changes' })}{' '}
                          <span className="text-xs text-gray-500 dark:text-gray-400">({myNeedsChangesCount})</span>
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* Submit Meme Button - only show on own pages */}
                {showSubmitButton && (
                  <HelpTooltip content={t('help.header.submit', { defaultValue: 'Submit a meme to your channel (upload or import).' })}>
                    <Button
                      onClick={() => setIsSubmitModalOpen(true)}
                      variant="ghost"
                      size="sm"
                      leftIcon={
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                      }
                      className="text-primary"
                      aria-label={t('header.submitMeme')}
                    >
                      <span className="text-sm hidden sm:inline">{t('header.submitMeme')}</span>
                    </Button>
                  </HelpTooltip>
                )}

                {/* Balance Display */}
                <div className="relative group">
                  <HelpTooltip content={t('help.header.balance', { defaultValue: 'Your coin balance. You can earn coins via the channel reward.' })}>
                    <button
                      type="button"
                      className="flex items-center gap-2 px-2 sm:px-3 py-2 rounded-xl bg-primary/10 dark:bg-primary/20 shadow-sm ring-1 ring-black/5 dark:ring-white/10"
                      onClick={() => {
                        setCoinUpdateDelta(null);
                      }}
                      aria-label={t('header.balance', 'Balance')}
                    >
                      {coinIconUrl || channelCoinIconUrl ? (
                        <img
                          src={coinIconUrl || channelCoinIconUrl || ''}
                          alt={t('header.coin', { defaultValue: 'Coin' })}
                          className="w-5 h-5"
                        />
                      ) : (
                        <svg className="w-5 h-5 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                          />
                        </svg>
                      )}
                      <div className="flex items-baseline gap-1">
                        <span className="text-sm sm:text-base font-bold text-gray-900 dark:text-white">
                          {isInfiniteBalance ? '∞' : isLoadingWallet ? '...' : balance}
                        </span>
                        <span className="text-xs text-gray-600 dark:text-gray-400 hidden sm:inline">coins</span>
                      </div>
                    </button>
                  </HelpTooltip>
                  {coinUpdateDelta !== null && coinUpdateDelta > 0 && (
                    <Pill
                      variant="successSolid"
                      size="sm"
                      className="absolute -top-1 -right-1 text-[10px] px-2 py-0.5 font-bold shadow"
                    >
                      +{coinUpdateDelta}
                    </Pill>
                  )}
                  {/* (Help tooltip is controlled via help-mode) */}
                </div>

                {/* User Menu */}
                <UserMenu />
              </div>
            ) : (
              <div className="flex items-center gap-1 sm:gap-3 flex-shrink-0">
                {/* Pending Submissions (guest preview) */}
                <button
                  type="button"
                  onClick={requireAuth}
                  className="relative p-2 rounded-xl transition-colors hover:bg-gray-100 dark:hover:bg-gray-700 opacity-80"
                  aria-label={t('auth.loginToInteract', 'Log in to submit memes and use favorites')}
                >
                  <svg className="w-6 h-6 text-gray-400 dark:text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
                    />
                  </svg>
                </button>

                {/* Submit Meme (guest preview) */}
                <HelpTooltip content={t('help.header.loginRequired', { defaultValue: 'Log in to submit memes and use favorites.' })}>
                  <Button
                    onClick={requireAuth}
                    aria-label={t('header.submitMeme', { defaultValue: 'Submit Meme' })}
                    variant="ghost"
                    size="sm"
                    leftIcon={
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                    }
                    className="text-primary"
                  >
                    <span className="text-sm hidden sm:inline">{t('header.submitMeme', { defaultValue: 'Submit Meme' })}</span>
                  </Button>
                </HelpTooltip>

                {/* Balance (guest preview) */}
                <div className="relative group">
                  <HelpTooltip content={t('help.header.loginToUseWallet', { defaultValue: 'Log in to earn coins and activate memes.' })}>
                    <button
                      type="button"
                      className="flex items-center gap-2 px-2 sm:px-3 py-2 rounded-xl bg-primary/10 dark:bg-primary/20 shadow-sm ring-1 ring-black/5 dark:ring-white/10 cursor-pointer"
                      onClick={requireAuth}
                      aria-label={t('header.balance', 'Balance')}
                    >
                      <svg className="w-5 h-5 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                        />
                      </svg>
                      <div className="flex items-baseline gap-1">
                        <span className="text-sm sm:text-base font-bold text-gray-900 dark:text-white">0</span>
                        <span className="text-xs text-gray-600 dark:text-gray-400 hidden sm:inline">coins</span>
                      </div>
                    </button>
                  </HelpTooltip>
                </div>

                {/* Guest identity */}
                <button
                  type="button"
                  onClick={requireAuth}
                  className="flex items-center gap-2 px-2 sm:px-3 py-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                >
                  <div className="w-8 h-8 rounded-lg bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-gray-600 dark:text-gray-200 font-bold">
                    ?
                  </div>
                  <span className="text-sm hidden sm:inline text-gray-800 dark:text-gray-100">
                    {t('auth.guest', { defaultValue: 'Guest' })}
                  </span>
                </button>
              </div>
            )}
          </div>
        </div>
      </nav>

      {/* Submit Modal */}
      <Suspense fallback={null}>
        <SubmitModal
          isOpen={isSubmitModalOpen}
          onClose={() => setIsSubmitModalOpen(false)}
          channelSlug={currentChannelSlug}
          channelId={isOwnProfile ? channelId : undefined}
        />

        <AuthRequiredModal
          isOpen={authModalOpen}
          onClose={() => setAuthModalOpen(false)}
          onCtaClick={() => {
            setAuthModalOpen(false);
            login(location.pathname + location.search);
          }}
        />
      </Suspense>
    </>
  );
}


