import { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAppSelector, useAppDispatch } from '../store/hooks';
import { store } from '../store/index';
import { updateWalletBalance } from '../store/slices/authSlice';
import { fetchSubmissions } from '../store/slices/submissionsSlice';
import { api } from '../lib/api';
import { useSocket } from '../contexts/SocketContext';
import { useChannelColors } from '../contexts/ChannelColorsContext';
import UserMenu from './UserMenu';
import SubmitModal from './SubmitModal';
import type { Wallet } from '../types';

interface HeaderProps {
  channelSlug?: string;
  channelId?: string;
  primaryColor?: string | null;
  coinIconUrl?: string | null;
  rewardTitle?: string | null;
}

export default function Header({ channelSlug, channelId, primaryColor, coinIconUrl, rewardTitle }: HeaderProps) {
  const { t } = useTranslation();
  const { user } = useAppSelector((state) => state.auth);
  const { submissions, loading: submissionsLoading } = useAppSelector((state) => state.submissions);
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams<{ slug: string }>();
  const { getChannelData, getCachedChannelData } = useChannelColors();
  
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [isSubmitModalOpen, setIsSubmitModalOpen] = useState(false);
  const [isLoadingWallet, setIsLoadingWallet] = useState(false);
  const [channelCoinIconUrl, setChannelCoinIconUrl] = useState<string | null>(null);
  const [channelRewardTitle, setChannelRewardTitle] = useState<string | null>(null);
  const { socket } = useSocket();
  const [coinUpdateCount, setCoinUpdateCount] = useState(0);
  const [lastCoinDelta, setLastCoinDelta] = useState<number | null>(null);
  const coinUpdateHideTimerRef = useRef<number | null>(null);
  const submissionsLoadedRef = useRef(false);
  const walletLoadedRef = useRef<string | null>(null); // Track which channel's wallet was loaded
  const channelDataLoadedRef = useRef<string | null>(null); // Track which channel's data was loaded

  // Determine if we're on own profile page
  const isOwnProfile = user && channelId && user.channelId === channelId;
  const currentChannelSlug = channelSlug || params.slug;

  // Determine if submit button should be shown
  // Show only on: /dashboard, /settings, or own profile
  // Hide on: other profiles (/channel/:slug where slug !== user.channel?.slug)
  const showSubmitButton = user && (
    location.pathname === '/dashboard' ||
    location.pathname.startsWith('/settings') ||
    isOwnProfile
  );

  // Load submissions for streamer/admin if not already loaded
  // Check Redux store with TTL to avoid duplicate requests on navigation
  useEffect(() => {
    if (user && (user.role === 'streamer' || user.role === 'admin') && user.channelId) {
      const currentState = store.getState();
      const submissionsState = currentState.submissions;
      const SUBMISSIONS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
      const ERROR_RETRY_DELAY = 5 * 60 * 1000; // 5 minutes before retrying after error
      
      // Check if we have fresh data based on timestamp
      const hasFreshData = submissionsState.submissions.length > 0 && 
        submissionsState.lastFetchedAt !== null &&
        (Date.now() - submissionsState.lastFetchedAt) < SUBMISSIONS_CACHE_TTL;
      
      // Check if we had a recent error (especially 403) - don't retry immediately
      const hasRecentError = submissionsState.lastErrorAt !== null &&
        (Date.now() - submissionsState.lastErrorAt) < ERROR_RETRY_DELAY;
      
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
    if (!user || !user.channelId) {
      submissionsLoadedRef.current = false;
    }
  }, [user?.id, user?.role, user?.channelId, dispatch]); // Use user?.id instead of user to prevent unnecessary re-runs

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
    if (!user) {
      setWallet(null);
      walletLoadedRef.current = null;
      return;
    }

    // Don't load wallet in Header if we're on a channel page - it's loaded by StreamerProfile
    const isChannelPage = location.pathname.startsWith('/channel/');
    if (isChannelPage) {
      // Use wallet from Redux store if available, or from user data
      if (channelId && user.wallets) {
        const userWallet = user.wallets.find(w => w.channelId === channelId);
        if (userWallet) {
          setWallet(userWallet);
        }
      }
      walletLoadedRef.current = null; // Reset since we're not loading here
      return;
    }

    // Determine which channel's wallet to load
    const targetChannelSlug = currentChannelSlug || user.channel?.slug;
    const targetChannelId = channelId || user.channelId;

    // Check if wallet exists in user.wallets first - use Redux store as primary source
    if (targetChannelId && user.wallets) {
      const userWallet = user.wallets.find(w => w.channelId === targetChannelId);
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
      setIsLoadingWallet(true);
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
                  userId: user.id,
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
      }
    };

    // Load immediately on mount or when channel changes
    loadWallet();

    // Refresh when tab becomes visible (user returns to page)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && !isChannelPage) {
        loadWallet();
      }
    };

    // Refresh when window regains focus
    const handleFocus = () => {
      if (!isChannelPage) {
        loadWallet();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
    };
  }, [user, user?.channelId, user?.channel?.slug, currentChannelSlug, channelId, dispatch]);

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
        if ((coinIconUrl !== undefined || cached.coinIconUrl) && 
            (rewardTitle !== undefined || cached.rewardTitle)) {
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

    loadChannelData();
  }, [coinIconUrl, rewardTitle, user?.channel?.slug, currentChannelSlug]);

  // Setup Socket.IO listeners for real-time wallet updates
  // Socket connection is managed by SocketContext at app level
  useEffect(() => {
    if (!socket || !user) {
      return;
    }

    const handleWalletUpdate = (data: { userId: string; channelId: string; balance: number; delta?: number; reason?: string }) => {
      // Only update if it's for the current user and channel
      if (data.userId === user.id && (channelId ? data.channelId === channelId : true)) {
        setWallet((prev) => {
          const prevBalance = prev?.channelId === data.channelId ? prev.balance : (prev?.balance ?? 0);
          const delta = typeof data.delta === 'number' ? data.delta : (data.balance - prevBalance);

          // Show a header badge when coins are added from Twitch reward
          if (delta > 0 && (data.reason === 'twitch_reward' || data.reason === undefined)) {
            setCoinUpdateCount((c) => c + 1);
            setLastCoinDelta(delta);

            if (coinUpdateHideTimerRef.current) {
              window.clearTimeout(coinUpdateHideTimerRef.current);
            }
            coinUpdateHideTimerRef.current = window.setTimeout(() => {
              setCoinUpdateCount(0);
              setLastCoinDelta(null);
              coinUpdateHideTimerRef.current = null;
            }, 8000);
          }

          if (prev && prev.channelId === data.channelId) {
            return { ...prev, balance: data.balance };
          }

          // If Header had no wallet yet (first-time wallet creation), set it
          return {
            id: '',
            userId: user.id,
            channelId: data.channelId,
            balance: data.balance,
          };
        });
        // Update Redux store
        dispatch(updateWalletBalance({ channelId: data.channelId, balance: data.balance }));
      }
    };

    socket.on('wallet:updated', handleWalletUpdate);

    // Join user room if connected
    if (socket.connected && user) {
      socket.emit('join:user', user.id);
    }

    return () => {
      socket.off('wallet:updated', handleWalletUpdate);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, user?.id, channelId, dispatch]);

  // Update channel room when currentChannelSlug changes
  useEffect(() => {
    if (socket?.connected && currentChannelSlug) {
      socket.emit('join:channel', currentChannelSlug.trim().toLowerCase());
    }
  }, [socket, currentChannelSlug]);


  const handlePendingSubmissionsClick = () => {
    // If user uses the "notifications" entry point, clear coin notification badge as well
    setCoinUpdateCount(0);
    setLastCoinDelta(null);
    navigate('/settings?tab=submissions');
  };

  const pendingSubmissionsCount = submissions.filter(s => s.status === 'pending').length;
  // Show indicator for streamers/admins always, even if submissions are not loaded yet
  const showPendingIndicator = user && (user.role === 'streamer' || user.role === 'admin');
  const hasPendingSubmissions = pendingSubmissionsCount > 0;
  const isLoadingSubmissions = submissionsLoading && submissions.length === 0;
  // Remove add coin button - channel owners can activate memes for free
  const balance = wallet?.balance || 0;

  // Use CSS variables for colors when on public channel page, fallback to inline styles for other pages
  const navStyle: React.CSSProperties = {
    backgroundColor: primaryColor && !document.documentElement.classList.contains('dark') ? primaryColor : undefined,
  };

  const logoStyle: React.CSSProperties = {
    color: primaryColor && !document.documentElement.classList.contains('dark') ? '#ffffff' : undefined,
  };

  return (
    <>
      <nav 
        className="bg-white dark:bg-gray-800 shadow-sm channel-theme-nav"
        style={navStyle}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 items-center">
            <h1 
              className="text-xl font-bold dark:text-white cursor-pointer channel-theme-logo"
              onClick={() => navigate('/')}
              style={logoStyle}
            >
              Mem Alerts
            </h1>
            
            {user && (
              <div className="flex items-center gap-3">
                {/* Pending Submissions Indicator - always show for streamer/admin */}
                {showPendingIndicator && (
                  <button
                    onClick={handlePendingSubmissionsClick}
                    className={`relative p-2 rounded-lg transition-colors ${
                      hasPendingSubmissions
                        ? 'hover:bg-gray-100 dark:hover:bg-gray-700'
                        : 'hover:bg-gray-50 dark:hover:bg-gray-800 opacity-60'
                    }`}
                    title={isLoadingSubmissions
                      ? t('header.loadingSubmissions', 'Loading submissions...')
                      : hasPendingSubmissions 
                        ? (pendingSubmissionsCount === 1 ? t('header.pendingSubmissions', { count: 1 }) : t('header.pendingSubmissionsPlural', { count: pendingSubmissionsCount }))
                        : t('header.noPendingSubmissions', 'No pending submissions')
                    }
                    aria-label={isLoadingSubmissions
                      ? t('header.loadingSubmissions', 'Loading submissions...')
                      : hasPendingSubmissions 
                        ? (pendingSubmissionsCount === 1 ? t('header.pendingSubmissions', { count: 1 }) : t('header.pendingSubmissionsPlural', { count: pendingSubmissionsCount }))
                        : t('header.noPendingSubmissions', 'No pending submissions')
                    }
                  >
                    <svg 
                      className={`w-6 h-6 transition-colors ${
                        hasPendingSubmissions 
                          ? 'text-primary' 
                          : 'text-gray-400 dark:text-gray-500'
                      }`} 
                      fill="none" 
                      stroke="currentColor" 
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                    </svg>
                    {hasPendingSubmissions && !isLoadingSubmissions && (
                      <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center font-bold">
                        {pendingSubmissionsCount}
                      </span>
                    )}
                    {/* Coin notification badge (shown even if pending submissions badge is present) */}
                    {coinUpdateCount > 0 && lastCoinDelta !== null && (
                      <span className="absolute -bottom-1 -right-1 bg-green-600 text-white text-[10px] rounded-full px-2 py-0.5 font-bold shadow">
                        +{lastCoinDelta}{coinUpdateCount > 1 ? ` (${coinUpdateCount})` : ''}
                      </span>
                    )}
                  </button>
                )}

                {/* Submit Meme Button - only show on own pages */}
                {showSubmitButton && (
                  <button
                    onClick={() => setIsSubmitModalOpen(true)}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors text-primary font-medium"
                    title={t('header.submitMeme')}
                    aria-label={t('header.submitMeme')}
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    <span className="text-sm">{t('header.submitMeme')}</span>
                  </button>
                )}

                {/* Balance Display */}
                <div className="relative group">
                  <div
                    className="flex items-center gap-2 px-3 py-2 rounded-lg bg-primary/10 border border-primary/20"
                    onClick={() => {
                      setCoinUpdateCount(0);
                      setLastCoinDelta(null);
                    }}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        setCoinUpdateCount(0);
                        setLastCoinDelta(null);
                      }
                    }}
                    aria-label={t('header.balance', 'Balance')}
                  >
                    {(coinIconUrl || channelCoinIconUrl) ? (
                      <img src={coinIconUrl || channelCoinIconUrl || ''} alt="Coin" className="w-5 h-5" />
                    ) : (
                      <svg className="w-5 h-5 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    )}
                    <div className="flex items-baseline gap-1">
                      <span className="text-base font-bold text-gray-900 dark:text-white">
                        {isLoadingWallet ? '...' : balance}
                      </span>
                      <span className="text-xs text-gray-600 dark:text-gray-400">coins</span>
                    </div>
                  </div>
                  {coinUpdateCount > 0 && lastCoinDelta !== null && (
                    <span className="absolute -top-1 -right-1 bg-green-600 text-white text-[10px] rounded-full px-2 py-0.5 font-bold shadow">
                      +{lastCoinDelta}{coinUpdateCount > 1 ? ` (${coinUpdateCount})` : ''}
                    </span>
                  )}
                  {/* Tooltip */}
                  <div className="absolute right-0 top-full mt-2 w-56 bg-gray-900 text-white text-xs rounded-lg py-2 px-3 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 pointer-events-none z-50 shadow-xl">
                    {channelRewardTitle 
                      ? t('header.activateRewardToEarn', `Activate ${channelRewardTitle} to earn`, { rewardTitle: channelRewardTitle })
                      : t('header.redeemChannelPoints', 'Redeem channel points to earn')
                    }
                    <div className="absolute -top-1 right-4 w-2 h-2 bg-gray-900 transform rotate-45" />
                  </div>
                </div>

                {/* User Menu */}
                <UserMenu />
              </div>
            )}
          </div>
        </div>
      </nav>

      {/* Submit Modal */}
      <SubmitModal
        isOpen={isSubmitModalOpen}
        onClose={() => setIsSubmitModalOpen(false)}
        channelSlug={currentChannelSlug}
        channelId={isOwnProfile ? channelId : undefined}
      />

    </>
  );
}

