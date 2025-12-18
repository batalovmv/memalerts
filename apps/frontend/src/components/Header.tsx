import { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAppSelector, useAppDispatch } from '../store/hooks';
import { fetchSubmissions } from '../store/slices/submissionsSlice';
import { updateWalletBalance } from '../store/slices/authSlice';
import { api } from '../lib/api';
import { io, Socket } from 'socket.io-client';
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
  const { submissions } = useAppSelector((state) => state.submissions);
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
  const socketRef = useRef<Socket | null>(null);

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

  // Load pending submissions if user is streamer/admin
  useEffect(() => {
    if (user && (user.role === 'streamer' || user.role === 'admin')) {
      dispatch(fetchSubmissions({ status: 'pending' }));
    }
  }, [user, dispatch]);

  // Load wallet balance and auto-refresh
  useEffect(() => {
    if (!user) {
      setWallet(null);
      return;
    }

    const loadWallet = async () => {
      setIsLoadingWallet(true);
      try {
        if (currentChannelSlug) {
          // Load wallet for the current channel
          try {
            const walletResponse = await api.get<Wallet>(`/channels/${currentChannelSlug}/wallet`, {
              timeout: 10000,
            });
            setWallet(walletResponse.data);
            // Update Redux store if channelId matches
            if (channelId && walletResponse.data.channelId === channelId) {
              dispatch(updateWalletBalance({ channelId, balance: walletResponse.data.balance }));
            }
          } catch (error: any) {
            if (error.response?.status === 404 || error.code === 'ECONNABORTED') {
              // Wallet doesn't exist yet, set default
              if (channelId) {
                setWallet({
                  id: '',
                  userId: user.id,
                  channelId: channelId,
                  balance: 0,
                });
              }
            }
            console.warn('Failed to load wallet:', error);
          }
        } else if (user.channelId && user.wallets) {
          // Use wallet from user data
          const userWallet = user.wallets.find(w => w.channelId === user.channelId);
          if (userWallet) {
            setWallet(userWallet);
          }
        }
      } catch (error) {
        console.error('Error loading wallet:', error);
      } finally {
        setIsLoadingWallet(false);
      }
    };

    // Load immediately on mount
    loadWallet();

    // Refresh when tab becomes visible (user returns to page)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        loadWallet();
      }
    };

    // Refresh when window regains focus
    const handleFocus = () => {
      loadWallet();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
    };
  }, [user, currentChannelSlug, channelId, dispatch]);

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
        return;
      }

      // Otherwise, try to get from cache or fetch
      const slugToUse = user?.channel?.slug || currentChannelSlug;
      if (slugToUse) {
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
            return;
          }
        }

        // Don't fetch if we're on a channel page - data will be loaded by StreamerProfile
        // This avoids unnecessary requests with includeMemes=false
        if (location.pathname.startsWith('/channel/')) {
          return;
        }

        // If not in cache and not on channel page, fetch it
        const channelData = await getChannelData(slugToUse);
        if (channelData) {
          if (coinIconUrl === undefined && channelData.coinIconUrl) {
            setChannelCoinIconUrl(channelData.coinIconUrl);
          }
          if (rewardTitle === undefined && channelData.rewardTitle) {
            setChannelRewardTitle(channelData.rewardTitle);
          }
        }
      }
    };

    loadChannelData();
  }, [coinIconUrl, rewardTitle, user?.channel?.slug, currentChannelSlug, location.pathname, getChannelData, getCachedChannelData]);

  // Setup Socket.IO connection for real-time wallet updates
  // Use separate effects to avoid reconnection on dependency changes
  useEffect(() => {
    if (!user) {
      // Disconnect socket if user logs out
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      return;
    }

    // Get API URL for Socket.IO
    const getSocketUrl = () => {
      const envUrl = import.meta.env.VITE_API_URL;
      if (envUrl) {
        return envUrl;
      }
      if (import.meta.env.PROD) {
        return window.location.origin;
      }
      return 'http://localhost:3001';
    };

    // Only create socket if it doesn't exist
    if (!socketRef.current) {
      const socketUrl = getSocketUrl();
      const socket = io(socketUrl, {
        transports: ['websocket', 'polling'],
        withCredentials: true,
      });

      socketRef.current = socket;

      socket.on('connect', () => {
        console.log('Socket.IO connected');
        // Join user room for wallet updates
        if (user) {
          socket.emit('join:user', user.id);
        }
      });

      socket.on('wallet:updated', (data: { userId: string; channelId: string; balance: number }) => {
        // Only update if it's for the current user and channel
        if (data.userId === user.id && (channelId ? data.channelId === channelId : true)) {
          setWallet((prev) => {
            if (prev && prev.channelId === data.channelId) {
              return { ...prev, balance: data.balance };
            }
            return prev;
          });
          // Update Redux store
          dispatch(updateWalletBalance({ channelId: data.channelId, balance: data.balance }));
        }
      });

      socket.on('disconnect', () => {
        console.log('Socket.IO disconnected');
      });

      socket.on('connect_error', (error) => {
        console.error('Socket.IO connection error:', error);
      });
    } else {
      // Socket already exists, just update rooms if needed
      const socket = socketRef.current;
      if (socket.connected && user) {
        socket.emit('join:user', user.id);
      }
    }

    return () => {
      // Don't disconnect on dependency changes, only on unmount
      // Socket will be cleaned up when component unmounts or user logs out
    };
  }, [user?.id, dispatch]); // Only depend on user.id, not full user object

  // Update channel room when currentChannelSlug changes
  useEffect(() => {
    if (socketRef.current?.connected && currentChannelSlug) {
      socketRef.current.emit('join:channel', currentChannelSlug);
    }
  }, [currentChannelSlug]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    };
  }, []);

  const handlePendingSubmissionsClick = () => {
    navigate('/settings?tab=submissions');
  };

  const pendingSubmissionsCount = submissions.length;
  // Show indicator for streamers/admins always, but style it differently based on count
  const showPendingIndicator = user && (user.role === 'streamer' || user.role === 'admin');
  const hasPendingSubmissions = pendingSubmissionsCount > 0;
  // Remove add coin button - channel owners can activate memes for free
  const balance = wallet?.balance || 0;

  const navStyle: React.CSSProperties = {
    backgroundColor: primaryColor && !document.documentElement.classList.contains('dark') ? primaryColor : undefined,
  };

  const logoStyle: React.CSSProperties = {
    color: primaryColor && !document.documentElement.classList.contains('dark') ? '#ffffff' : undefined,
  };

  return (
    <>
      <nav className="bg-white dark:bg-gray-800 shadow-sm" style={navStyle}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 items-center">
            <h1 
              className="text-xl font-bold dark:text-white cursor-pointer"
              onClick={() => navigate('/')}
              style={logoStyle}
            >
              Mem Alerts
            </h1>
            
            {user && (
              <div className="flex items-center gap-3">
                {/* Pending Submissions Indicator */}
                {showPendingIndicator && (
                  <button
                    onClick={handlePendingSubmissionsClick}
                    className={`relative p-2 rounded-lg transition-colors ${
                      hasPendingSubmissions
                        ? 'hover:bg-gray-100 dark:hover:bg-gray-700'
                        : 'hover:bg-gray-50 dark:hover:bg-gray-800 opacity-60'
                    }`}
                    title={hasPendingSubmissions 
                      ? (pendingSubmissionsCount === 1 ? t('header.pendingSubmissions', { count: 1 }) : t('header.pendingSubmissionsPlural', { count: pendingSubmissionsCount }))
                      : t('header.noPendingSubmissions', 'No pending submissions')
                    }
                    aria-label={hasPendingSubmissions 
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
                    {hasPendingSubmissions && (
                      <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center font-bold">
                        {pendingSubmissionsCount}
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
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
                    {(coinIconUrl || channelCoinIconUrl) ? (
                      <img src={coinIconUrl || channelCoinIconUrl || ''} alt="Coin" className="w-5 h-5" />
                    ) : (
                      <svg className="w-5 h-5 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    )}
                    <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                      {isLoadingWallet ? '...' : balance}
                    </span>
                  </div>
                  {/* Tooltip */}
                  <div className="absolute right-0 top-full mt-2 w-64 bg-gray-900 text-white text-xs rounded-lg py-2 px-3 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50">
                    {channelRewardTitle 
                      ? t('header.coinsTooltipWithReward', `Активируйте ${channelRewardTitle} для получения монет`, { rewardTitle: channelRewardTitle })
                      : t('header.coinsTooltip')
                    }
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

