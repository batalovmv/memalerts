import { useState, useEffect } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAppSelector, useAppDispatch } from '../store/hooks';
import { fetchSubmissions } from '../store/slices/submissionsSlice';
import { updateWalletBalance } from '../store/slices/authSlice';
import { api } from '../lib/api';
import UserMenu from './UserMenu';
import SubmitModal from './SubmitModal';
import type { Wallet } from '../types';

interface HeaderProps {
  channelSlug?: string;
  channelId?: string;
  primaryColor?: string | null;
}

export default function Header({ channelSlug, channelId, primaryColor }: HeaderProps) {
  const { t } = useTranslation();
  const { user } = useAppSelector((state) => state.auth);
  const { submissions } = useAppSelector((state) => state.submissions);
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams<{ slug: string }>();
  
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [isSubmitModalOpen, setIsSubmitModalOpen] = useState(false);
  const [isLoadingWallet, setIsLoadingWallet] = useState(false);

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

    // Load immediately
    loadWallet();

    // Auto-refresh every 3 seconds
    const interval = setInterval(() => {
      loadWallet();
    }, 3000);

    return () => clearInterval(interval);
  }, [user, currentChannelSlug, channelId, dispatch]);

  const handlePendingSubmissionsClick = () => {
    navigate('/settings?tab=submissions');
  };

  const pendingSubmissionsCount = submissions.length;
  const showPendingIndicator = user && (user.role === 'streamer' || user.role === 'admin') && pendingSubmissionsCount > 0;
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
                    className="relative p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                    title={pendingSubmissionsCount === 1 ? t('header.pendingSubmissions', { count: 1 }) : t('header.pendingSubmissionsPlural', { count: pendingSubmissionsCount })}
                    aria-label={pendingSubmissionsCount === 1 ? t('header.pendingSubmissions', { count: 1 }) : t('header.pendingSubmissionsPlural', { count: pendingSubmissionsCount })}
                  >
                    <svg className="w-6 h-6 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                    </svg>
                    <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center font-bold">
                      {pendingSubmissionsCount}
                    </span>
                  </button>
                )}

                {/* Submit Meme Button - only show on own pages */}
                {showSubmitButton && (
                  <button
                    onClick={() => setIsSubmitModalOpen(true)}
                    className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                    title={t('header.submitMeme')}
                    aria-label={t('header.submitMeme')}
                  >
                    <svg className="w-6 h-6 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                  </button>
                )}

                {/* Balance Display */}
                <div className="relative group">
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
                    <svg className="w-5 h-5 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                      {isLoadingWallet ? '...' : balance}
                    </span>
                  </div>
                  {/* Tooltip */}
                  <div className="absolute right-0 top-full mt-2 w-48 bg-gray-900 text-white text-xs rounded-lg py-2 px-3 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50">
                    {t('header.coinsTooltip')}
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

