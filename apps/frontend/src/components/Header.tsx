import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAppSelector, useAppDispatch } from '../store/hooks';
import { fetchSubmissions } from '../store/slices/submissionsSlice';
import { api } from '../lib/api';
import UserMenu from './UserMenu';
import SubmitModal from './SubmitModal';
import toast from 'react-hot-toast';
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
  const params = useParams<{ slug: string }>();
  
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [isSubmitModalOpen, setIsSubmitModalOpen] = useState(false);
  const [isAddCoinModalOpen, setIsAddCoinModalOpen] = useState(false);
  const [coinAmount, setCoinAmount] = useState('');
  const [isAddingCoins, setIsAddingCoins] = useState(false);
  const [isLoadingWallet, setIsLoadingWallet] = useState(false);

  // Determine if we're on own profile page
  const isOwnProfile = user && channelId && user.channelId === channelId;
  const currentChannelSlug = channelSlug || params.slug;

  // Load pending submissions if user is streamer/admin
  useEffect(() => {
    if (user && (user.role === 'streamer' || user.role === 'admin')) {
      dispatch(fetchSubmissions({ status: 'pending' }));
    }
  }, [user, dispatch]);

  // Load wallet balance
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

    loadWallet();
  }, [user, currentChannelSlug, channelId]);

  const handleAddCoins = async () => {
    if (!user || !wallet || !isOwnProfile) {
      return;
    }

    const amount = parseInt(coinAmount, 10);
    if (isNaN(amount) || amount <= 0) {
      toast.error(t('header.validPositiveAmount'));
      return;
    }

    setIsAddingCoins(true);
    try {
      await api.post(`/admin/wallets/${user.id}/${wallet.channelId}/adjust`, { amount });
      toast.success(t('header.addedCoins', { amount }));
      setCoinAmount('');
      setIsAddCoinModalOpen(false);
      
      // Refresh wallet
      if (currentChannelSlug) {
        try {
          const walletResponse = await api.get<Wallet>(`/channels/${currentChannelSlug}/wallet`);
          setWallet(walletResponse.data);
        } catch (error) {
          console.error('Error refreshing wallet:', error);
        }
      }
    } catch (error: any) {
      toast.error(error.response?.data?.error || t('header.failedToAddCoins'));
    } finally {
      setIsAddingCoins(false);
    }
  };

  const handlePendingSubmissionsClick = () => {
    navigate('/settings?tab=submissions');
  };

  const pendingSubmissionsCount = submissions.length;
  const showPendingIndicator = user && (user.role === 'streamer' || user.role === 'admin') && pendingSubmissionsCount > 0;
  const showAddCoinButton = isOwnProfile && (user?.role === 'streamer' || user?.role === 'admin');
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

                {/* Submit Meme Button */}
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

                {/* Balance Display */}
                <div className="relative group">
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
                    <svg className="w-5 h-5 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                      {isLoadingWallet ? '...' : balance}
                    </span>
                    {showAddCoinButton && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setIsAddCoinModalOpen(true);
                        }}
                        className="ml-1 p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                        title={t('header.addCoins')}
                        aria-label={t('header.addCoins')}
                      >
                        <svg className="w-4 h-4 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                      </button>
                    )}
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
      />

      {/* Add Coins Modal */}
      {isAddCoinModalOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div 
            className="fixed inset-0 bg-black/50 transition-opacity"
            onClick={() => setIsAddCoinModalOpen(false)}
            aria-hidden="true"
          />
          <div className="flex min-h-full items-center justify-center p-4">
            <div className="relative bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full">
              <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center">
                <h2 className="text-xl font-bold dark:text-white">{t('header.addCoinsTitle')}</h2>
                <button
                  onClick={() => setIsAddCoinModalOpen(false)}
                  className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                  aria-label={t('common.cancel')}
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="p-6">
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    {t('admin.amount')}
                  </label>
                  <input
                    type="number"
                    value={coinAmount}
                    onChange={(e) => setCoinAmount(e.target.value)}
                    min="1"
                    placeholder={t('header.enterAmount')}
                    className="w-full border border-secondary/30 dark:border-secondary/30 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-2 focus:ring-2 focus:ring-primary focus:border-primary"
                    autoFocus
                  />
                </div>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => setIsAddCoinModalOpen(false)}
                    disabled={isAddingCoins}
                    className="flex-1 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 disabled:bg-gray-100 disabled:cursor-not-allowed text-gray-800 dark:text-gray-200 font-semibold py-2 px-4 rounded-lg transition-colors"
                  >
                    {t('common.cancel')}
                  </button>
                  <button
                    onClick={handleAddCoins}
                    disabled={isAddingCoins || !coinAmount}
                    className="flex-1 bg-primary hover:bg-secondary disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-semibold py-2 px-4 rounded-lg transition-colors border border-secondary/30"
                  >
                    {isAddingCoins ? t('header.adding') : t('header.addCoinsButton')}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

