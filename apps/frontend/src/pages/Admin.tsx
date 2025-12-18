import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAppSelector, useAppDispatch } from '../store/hooks';
import { fetchSubmissions, approveSubmission, rejectSubmission } from '../store/slices/submissionsSlice';
import { fetchMemes } from '../store/slices/memesSlice';
import { useChannelColors } from '../contexts/ChannelColorsContext';
import Header from '../components/Header';
import VideoPreview from '../components/VideoPreview';
import MemeCard from '../components/MemeCard';
import MemeModal from '../components/MemeModal';
import { api } from '../lib/api';
import toast from 'react-hot-toast';
import type { Meme } from '../types';

type TabType = 'submissions' | 'memes' | 'settings' | 'wallets' | 'promotions' | 'statistics' | 'beta';

export default function Admin() {
  const { t } = useTranslation();
  const { user, loading: authLoading } = useAppSelector((state) => state.auth);
  const { submissions, loading: submissionsLoading, error: submissionsError } = useAppSelector((state) => state.submissions);
  const { memes } = useAppSelector((state) => state.memes);
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<TabType>('submissions');
  const [selectedMeme, setSelectedMeme] = useState<Meme | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Handle tab parameter from URL
  useEffect(() => {
    const tabParam = searchParams.get('tab');
    if (tabParam && ['submissions', 'memes', 'settings', 'wallets', 'promotions', 'statistics'].includes(tabParam)) {
      setActiveTab(tabParam as TabType);
    }
  }, [searchParams]);

  useEffect(() => {
    if (!authLoading && (!user || (user.role !== 'streamer' && user.role !== 'admin'))) {
      navigate('/dashboard');
    }
  }, [user, authLoading, navigate]);

  useEffect(() => {
    if (user && (user.role === 'streamer' || user.role === 'admin')) {
      // Only fetch if not already loaded (check Redux store)
      // Submissions might already be loaded by Dashboard or Header
      const currentSubmissions = submissions.filter(s => s.status === 'pending');
      if (currentSubmissions.length === 0) {
        dispatch(fetchSubmissions({ status: 'pending' }));
      }
      dispatch(fetchMemes({ channelId: user.channelId }));
    }
  }, [user, dispatch, submissions]);

  const handleApprove = async (submissionId: string): Promise<void> => {
    // Use standard values: 100 coins and 15 seconds (15000ms) max duration
    // Backend will handle getting actual video duration if needed
    const STANDARD_PRICE_COINS = 100;
    const STANDARD_DURATION_MS = 15000; // 15 seconds max

    try {
      await dispatch(approveSubmission({ 
        submissionId, 
        priceCoins: STANDARD_PRICE_COINS, 
        durationMs: STANDARD_DURATION_MS 
      })).unwrap();
      toast.success(t('admin.approve') + '!');
      dispatch(fetchSubmissions({ status: 'pending' }));
      if (user) {
        dispatch(fetchMemes({ channelId: user.channelId }));
      }
    } catch (error) {
      toast.error(t('admin.failedToApprove') || 'Failed to approve submission');
    }
  };

  const handleReject = async (submissionId: string): Promise<void> => {
    try {
      await dispatch(rejectSubmission({ submissionId, moderatorNotes: null })).unwrap();
      toast.success(t('admin.reject') + '!');
      dispatch(fetchSubmissions({ status: 'pending' }));
    } catch (error) {
      toast.error(t('admin.failedToReject') || 'Failed to reject submission');
    }
  };

  if (authLoading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-xl">{t('common.loading')}</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900">
      <Header />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-6">
          <div className="flex gap-4 border-b border-secondary/30">
            <button
              onClick={() => setActiveTab('submissions')}
              className={`pb-2 px-4 transition-colors ${
                activeTab === 'submissions'
                  ? 'border-b-2 border-primary text-primary'
                  : 'text-gray-600 dark:text-gray-400 hover:text-primary dark:hover:text-primary'
              }`}
            >
              {t('admin.pendingSubmissions')} ({submissions.length})
            </button>
            <button
              onClick={() => setActiveTab('memes')}
              className={`pb-2 px-4 transition-colors ${
                activeTab === 'memes'
                  ? 'border-b-2 border-primary text-primary'
                  : 'text-gray-600 dark:text-gray-400 hover:text-primary dark:hover:text-primary'
              }`}
            >
              {t('admin.allMemes')} ({memes.length})
            </button>
            <button
              onClick={() => setActiveTab('settings')}
              className={`pb-2 px-4 transition-colors ${
                activeTab === 'settings'
                  ? 'border-b-2 border-primary text-primary'
                  : 'text-gray-600 dark:text-gray-400 hover:text-primary dark:hover:text-primary'
              }`}
            >
              {t('admin.channelSettings')}
            </button>
            {user?.role === 'admin' && (
              <button
                onClick={() => setActiveTab('wallets')}
                className={`pb-2 px-4 transition-colors ${
                  activeTab === 'wallets'
                    ? 'border-b-2 border-primary text-primary'
                    : 'text-gray-600 dark:text-gray-400 hover:text-primary dark:hover:text-primary'
                }`}
              >
                {t('admin.walletManagement')}
              </button>
            )}
            <button
              onClick={() => setActiveTab('promotions')}
              className={`pb-2 px-4 transition-colors ${
                activeTab === 'promotions'
                  ? 'border-b-2 border-primary text-primary'
                  : 'text-gray-600 dark:text-gray-400 hover:text-primary dark:hover:text-primary'
              }`}
            >
              {t('admin.promotions')}
            </button>
            <button
              onClick={() => setActiveTab('statistics')}
              className={`pb-2 px-4 transition-colors ${
                activeTab === 'statistics'
                  ? 'border-b-2 border-primary text-primary'
                  : 'text-gray-600 dark:text-gray-400 hover:text-primary dark:hover:text-primary'
              }`}
            >
              {t('admin.statistics')}
            </button>
            {user?.role === 'admin' && (
              <button
                onClick={() => setActiveTab('beta')}
                className={`pb-2 px-4 transition-colors ${
                  activeTab === 'beta'
                    ? 'border-b-2 border-primary text-primary'
                    : 'text-gray-600 dark:text-gray-400 hover:text-primary dark:hover:text-primary'
                }`}
              >
                {t('admin.betaAccess')}
              </button>
            )}
          </div>
        </div>

        {activeTab === 'submissions' && (
          <div className="space-y-4">
            {submissionsLoading ? (
              <div className="text-center py-8">{t('admin.loadingSubmissions')}</div>
            ) : submissionsError ? (
              <div className="text-center py-8">
                <p className="text-red-600 dark:text-red-400 mb-4">{submissionsError}</p>
                <button
                  onClick={() => dispatch(fetchSubmissions({ status: 'pending' }))}
                  className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded"
                >
                  {t('common.retry') || 'Retry'}
                </button>
              </div>
            ) : submissions.length === 0 ? (
              <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                <p>{t('admin.noSubmissions')}</p>
                <p className="text-sm mt-2">{t('admin.allSubmissionsReviewed')}</p>
              </div>
            ) : (
                     submissions.map((submission) => (
                       <div key={submission.id} className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
                         <div className="flex justify-between items-start mb-4">
                           <div className="flex-1">
                             <h3 className="font-semibold text-lg dark:text-white">{submission.title}</h3>
                             <p className="text-sm text-gray-600 dark:text-gray-400">
                               By {submission.submitter.displayName} • {submission.type}
                             </p>
                             {submission.notes && (
                               <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">{submission.notes}</p>
                             )}
                             {submission.tags && submission.tags.length > 0 && (
                               <div className="flex flex-wrap gap-1 mt-2">
                                 {submission.tags.map((tagItem, idx) => (
                                   <span
                                     key={idx}
                                     className="px-2 py-1 bg-accent/20 text-accent rounded text-xs"
                                   >
                                     {tagItem.tag.name}
                                   </span>
                                 ))}
                               </div>
                             )}
                    </div>
                  </div>
                  
                  {/* Video Preview */}
                  <div className="mb-4">
                    <VideoPreview 
                      src={submission.fileUrlTemp} 
                      title={submission.title}
                      className="w-full"
                    />
                  </div>
                  
                  <div className="flex gap-2">
                  <button
                    onClick={() => handleApprove(submission.id)}
                    className="bg-primary hover:bg-secondary text-white px-4 py-2 rounded transition-colors border border-secondary/30"
                  >
                    {t('admin.approve')}
                  </button>
                  <button
                    onClick={() => handleReject(submission.id)}
                    className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded transition-colors border border-red-500/30"
                  >
                    {t('admin.reject')}
                  </button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {activeTab === 'memes' && (
          <>
            <div 
              className="columns-2 md:columns-3 lg:columns-4 xl:columns-5 gap-0"
              style={{ columnGap: 0 }}
            >
              {memes.map((meme: Meme) => {
                const isOwner = user?.channelId === meme.channelId && (user?.role === 'streamer' || user?.role === 'admin');
                return (
                  <MemeCard
                    key={meme.id}
                    meme={meme}
                    onClick={() => {
                      setSelectedMeme(meme);
                      setIsModalOpen(true);
                    }}
                    isOwner={isOwner}
                  />
                );
              })}
            </div>
            <MemeModal
              meme={selectedMeme}
              isOpen={isModalOpen}
              onClose={() => {
                setIsModalOpen(false);
                setSelectedMeme(null);
              }}
              onUpdate={() => {
                if (user) {
                  dispatch(fetchMemes({ channelId: user.channelId }));
                }
              }}
              isOwner={user?.channelId === selectedMeme?.channelId && (user?.role === 'streamer' || user?.role === 'admin')}
              mode="admin"
            />
          </>
        )}

        {activeTab === 'settings' && (
          <ChannelSettings />
        )}

        {activeTab === 'wallets' && user?.role === 'admin' && (
          <WalletManagement />
        )}

        {activeTab === 'promotions' && (
          <PromotionManagement />
        )}

        {activeTab === 'statistics' && (
          <ChannelStatistics />
        )}

        {activeTab === 'beta' && user?.role === 'admin' && (
          <BetaAccessManagement />
        )}
      </main>
    </div>
  );
}

// Wallet Management Component (Admin only)
function WalletManagement() {
  const [wallets, setWallets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [adjusting, setAdjusting] = useState<string | null>(null);
  const [adjustAmount, setAdjustAmount] = useState('');

  useEffect(() => {
    fetchWallets();
  }, []);

  const fetchWallets = async () => {
    try {
      setLoading(true);
      const { api } = await import('../lib/api');
      const wallets = await api.get('/admin/wallets');
      setWallets(wallets);
    } catch (error: any) {
      toast.error(error.response?.data?.error || t('admin.failedToLoadWallets') || 'Failed to load wallets');
    } finally {
      setLoading(false);
    }
  };

  const handleAdjust = async (userId: string, channelId: string) => {
    const amount = parseInt(adjustAmount, 10);
    if (isNaN(amount) || amount === 0) {
      toast.error(t('admin.enterAmount'));
      return;
    }

    try {
      setAdjusting(`${userId}-${channelId}`);
      const { api } = await import('../lib/api');
      await api.post(`/admin/wallets/${userId}/${channelId}/adjust`, { amount });
      toast.success(amount > 0 ? t('admin.balanceIncreased', { amount: Math.abs(amount) }) : t('admin.balanceDecreased', { amount: Math.abs(amount) }));
      setAdjustAmount('');
      fetchWallets();
    } catch (error: any) {
      toast.error(error.response?.data?.error || t('admin.failedToAdjustBalance') || 'Failed to adjust balance');
    } finally {
      setAdjusting(null);
    }
  };

  const { t } = useTranslation();

  if (loading) {
    return <div className="text-center py-8">{t('admin.loadingWallets')}</div>;
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-2xl font-bold mb-4">{t('admin.walletManagement')}</h2>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b">
                <th className="text-left p-2">{t('admin.user')}</th>
                <th className="text-left p-2">{t('admin.channel') || 'Channel'}</th>
                <th className="text-left p-2">{t('admin.balance') || 'Balance'}</th>
                <th className="text-left p-2">{t('common.actions') || 'Actions'}</th>
              </tr>
            </thead>
            <tbody>
              {wallets.map((wallet) => (
                <tr key={wallet.id} className="border-b">
                  <td className="p-2">{wallet.user.displayName}</td>
                  <td className="p-2">{wallet.channel.name}</td>
                  <td className="p-2 font-bold">{wallet.balance} coins</td>
                  <td className="p-2">
                    <div className="flex gap-2 items-center">
                      <input
                        type="number"
                        value={adjusting === `${wallet.userId}-${wallet.channelId}` ? adjustAmount : ''}
                        onChange={(e) => setAdjustAmount(e.target.value)}
                        placeholder={t('admin.amount')}
                        className="w-24 border border-gray-300 rounded px-2 py-1 text-sm"
                        disabled={adjusting !== null && adjusting !== `${wallet.userId}-${wallet.channelId}`}
                      />
                      <button
                        onClick={() => handleAdjust(wallet.userId, wallet.channelId)}
                        disabled={adjusting !== null}
                        className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white px-3 py-1 rounded text-sm"
                      >
                        {adjusting === `${wallet.userId}-${wallet.channelId}` ? t('admin.adjusting') : t('admin.adjust')}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {wallets.length === 0 && (
          <div className="text-center py-8 text-gray-500">{t('admin.noWallets')}</div>
        )}
      </div>
    </div>
  );
}

// Channel Settings Component
function ChannelSettings() {
  const { t } = useTranslation();
  const { user } = useAppSelector((state) => state.auth);
  const { getChannelData, getCachedChannelData } = useChannelColors();
  const [settings, setSettings] = useState({
    rewardIdForCoins: '',
    coinPerPointRatio: '1.0',
    rewardEnabled: false,
    rewardTitle: '',
    rewardCost: '',
    rewardCoins: '',
    primaryColor: '',
    secondaryColor: '',
    accentColor: '',
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Load current settings
    if (user?.channelId && user?.channel?.slug) {
      loadSettings();
    }
  }, [user?.channelId, user?.channel?.slug, getChannelData, getCachedChannelData]);

  const loadSettings = async () => {
    if (!user?.channel?.slug) return;
    
    try {
      // Check cache first
      const cached = getCachedChannelData(user.channel.slug);
      if (cached) {
        setSettings({
          rewardIdForCoins: cached.rewardIdForCoins || '',
          coinPerPointRatio: String(cached.coinPerPointRatio || '1.0'),
          rewardEnabled: cached.rewardEnabled || false,
          rewardTitle: cached.rewardTitle || '',
          rewardCost: cached.rewardCost ? String(cached.rewardCost) : '',
          rewardCoins: cached.rewardCoins ? String(cached.rewardCoins) : '',
          primaryColor: cached.primaryColor || '',
          secondaryColor: cached.secondaryColor || '',
          accentColor: cached.accentColor || '',
        });
        return;
      }

      // If not in cache, fetch it
      const channelData = await getChannelData(user.channel.slug);
      if (channelData) {
        setSettings({
          rewardIdForCoins: channelData.rewardIdForCoins || '',
          coinPerPointRatio: String(channelData.coinPerPointRatio || '1.0'),
          rewardEnabled: channelData.rewardEnabled || false,
          rewardTitle: channelData.rewardTitle || '',
          rewardCost: channelData.rewardCost ? String(channelData.rewardCost) : '',
          rewardCoins: channelData.rewardCoins ? String(channelData.rewardCoins) : '',
          primaryColor: channelData.primaryColor || '',
          secondaryColor: channelData.secondaryColor || '',
          accentColor: channelData.accentColor || '',
        });
      }
    } catch (error) {
      console.error('Failed to load settings:', error);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { api } = await import('../lib/api');
      await api.patch('/admin/channel/settings', {
        rewardIdForCoins: settings.rewardIdForCoins || null,
        coinPerPointRatio: 1.0, // Legacy field, not used anymore
        rewardEnabled: settings.rewardEnabled,
        rewardTitle: settings.rewardTitle || null,
        rewardCost: settings.rewardCost ? parseInt(settings.rewardCost, 10) : null,
        rewardCoins: settings.rewardCoins ? parseInt(settings.rewardCoins, 10) : null,
        primaryColor: settings.primaryColor || null,
        secondaryColor: settings.secondaryColor || null,
        accentColor: settings.accentColor || null,
      });
      toast.success(t('admin.settingsSaved'));
      // Reload settings to get updated rewardId and state
      await loadSettings();
      // Don't reload page - just update the UI
    } catch (error: any) {
      const errorMessage = error.response?.data?.error || t('admin.failedToSaveSettings') || 'Failed to save settings';
      toast.error(errorMessage);
      
      // If requires reauth, show special message
      if (error.response?.data?.requiresReauth) {
        setTimeout(() => {
          if (window.confirm(t('admin.requiresReauth') || 'You need to log out and log in again to enable Twitch rewards. Log out now?')) {
            // Logout and redirect to login
            window.location.href = '/';
          }
        }, 2000);
      }
    } finally {
      setLoading(false);
    }
  };

  const profileUrl = user?.channel?.slug ? `https://twitchmemes.ru/channel/${user.channel.slug}` : '';

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 border border-secondary/20">
      <h2 className="text-2xl font-bold mb-4 dark:text-white">{t('admin.channelSettings')}</h2>
      
      {/* Profile Link Section */}
      {profileUrl && (
        <div className="mb-6 pb-6 border-b border-gray-200 dark:border-gray-700">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            {t('admin.profileLink')}
          </label>
          <div className="flex items-center gap-2">
            <input
              type="text"
              readOnly
              value={profileUrl}
              className="flex-1 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-2 bg-gray-50 dark:bg-gray-700 text-sm"
            />
            <button
              type="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(profileUrl);
                  toast.success(t('toast.linkCopied'));
                } catch (error) {
                  toast.error(t('toast.failedToCopyLink'));
                }
              }}
              className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors border border-gray-300 dark:border-gray-600"
              title={t('dashboard.copyLink')}
            >
              <svg className="w-5 h-5 text-gray-600 dark:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </button>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            {t('dashboard.shareLinkDescription')}
          </p>
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-4">
        {/* Reward Toggle */}
        <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4 border border-secondary/20">
          <div className="flex items-center justify-between mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t('admin.enableReward')}
              </label>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {t('admin.enableRewardDescription')}
              </p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={settings.rewardEnabled}
                onChange={(e) => setSettings({ ...settings, rewardEnabled: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/20 dark:peer-focus:ring-primary/30 rounded-full peer dark:bg-gray-600 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-primary"></div>
            </label>
          </div>

          {settings.rewardEnabled && (
            <div className="space-y-4 mt-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {t('admin.rewardTitle')}
                </label>
                <input
                  type="text"
                  value={settings.rewardTitle}
                  onChange={(e) => setSettings({ ...settings, rewardTitle: e.target.value })}
                  className="w-full border border-secondary/30 dark:border-secondary/30 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-2 focus:ring-2 focus:ring-primary focus:border-primary"
                  placeholder={t('admin.rewardTitlePlaceholder')}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    {t('admin.rewardCost')}
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={settings.rewardCost}
                    onChange={(e) => setSettings({ ...settings, rewardCost: e.target.value })}
                    className="w-full border border-secondary/30 dark:border-secondary/30 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-2 focus:ring-2 focus:ring-primary focus:border-primary"
                    placeholder="100"
                    required={settings.rewardEnabled}
                  />
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    {t('admin.rewardCostDescription')}
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    {t('admin.rewardCoins')}
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={settings.rewardCoins}
                    onChange={(e) => setSettings({ ...settings, rewardCoins: e.target.value })}
                    className="w-full border border-secondary/30 dark:border-secondary/30 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-2 focus:ring-2 focus:ring-primary focus:border-primary"
                    placeholder="100"
                    required={settings.rewardEnabled}
                  />
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    {t('admin.rewardCoinsDescription')}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            {t('admin.rewardIdForCoins')} ({t('admin.autoGenerated')})
          </label>
          <input
            type="text"
            value={settings.rewardIdForCoins}
            readOnly
            className="w-full border border-secondary/30 dark:border-secondary/30 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-2 bg-gray-100 dark:bg-gray-600 cursor-not-allowed"
            placeholder={t('admin.rewardIdPlaceholder')}
          />
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            {t('admin.rewardIdDescription')}
          </p>
        </div>

        <div className="border-t border-secondary/30 pt-4 mt-4">
          <h3 className="text-lg font-semibold mb-4">{t('admin.colorCustomization')}</h3>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t('admin.primaryColor')}
              </label>
              <div className="flex gap-2">
                <input
                  type="color"
                  value={settings.primaryColor || '#9333ea'}
                  onChange={(e) => setSettings({ ...settings, primaryColor: e.target.value })}
                  className="w-16 h-10 rounded border border-gray-300 dark:border-gray-600"
                />
                <input
                  type="text"
                  value={settings.primaryColor}
                  onChange={(e) => setSettings({ ...settings, primaryColor: e.target.value })}
                  placeholder="#9333ea"
                  pattern="^#[0-9A-Fa-f]{6}$"
                  className="flex-1 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-2"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t('admin.secondaryColor')}
              </label>
              <div className="flex gap-2">
                <input
                  type="color"
                  value={settings.secondaryColor || '#4f46e5'}
                  onChange={(e) => setSettings({ ...settings, secondaryColor: e.target.value })}
                  className="w-16 h-10 rounded border border-gray-300 dark:border-gray-600"
                />
                <input
                  type="text"
                  value={settings.secondaryColor}
                  onChange={(e) => setSettings({ ...settings, secondaryColor: e.target.value })}
                  placeholder="#4f46e5"
                  pattern="^#[0-9A-Fa-f]{6}$"
                  className="flex-1 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-2"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t('admin.accentColor')}
              </label>
              <div className="flex gap-2">
                <input
                  type="color"
                  value={settings.accentColor || '#ec4899'}
                  onChange={(e) => setSettings({ ...settings, accentColor: e.target.value })}
                  className="w-16 h-10 rounded border border-gray-300 dark:border-gray-600"
                />
                <input
                  type="text"
                  value={settings.accentColor}
                  onChange={(e) => setSettings({ ...settings, accentColor: e.target.value })}
                  placeholder="#ec4899"
                  pattern="^#[0-9A-Fa-f]{6}$"
                  className="flex-1 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-2"
                />
              </div>
            </div>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
            {t('admin.colorsVisibleToVisitors')}
          </p>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="bg-primary hover:bg-secondary disabled:bg-gray-300 text-white font-semibold py-2 px-4 rounded-lg transition-colors border border-secondary/30"
        >
          {loading ? t('admin.saving') : t('admin.saveSettings')}
        </button>
      </form>
    </div>
  );
}

// Channel Statistics Component
function ChannelStatistics() {
  const { t } = useTranslation();
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchStats();
  }, []);

  const fetchStats = async () => {
    try {
      setLoading(true);
      const { api } = await import('../lib/api');
      const stats = await api.get('/admin/stats/channel');
      setStats(stats);
    } catch (error: any) {
      toast.error(error.response?.data?.error || t('admin.failedToLoadStatistics') || 'Failed to load statistics');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="text-center py-8">{t('admin.loadingStatistics')}</div>;
  }

  if (!stats) {
    return <div className="text-center py-8 text-gray-500">{t('admin.noStatistics')}</div>;
  }

  return (
    <div className="space-y-6">
      {/* Overall Stats */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-2xl font-bold mb-4">{t('admin.overallStatistics') || 'Overall Statistics'}</h2>
        <div className="grid grid-cols-3 gap-4">
          <div className="text-center p-4 bg-primary/10 rounded-lg border border-secondary/20">
            <p className="text-3xl font-bold text-primary">{stats.overall.totalActivations}</p>
            <p className="text-sm text-gray-600 dark:text-gray-400">{t('admin.totalActivations')}</p>
          </div>
          <div className="text-center p-4 bg-accent/10 rounded-lg border border-secondary/20">
            <p className="text-3xl font-bold text-accent">{stats.overall.totalCoinsSpent}</p>
            <p className="text-sm text-gray-600 dark:text-gray-400">{t('admin.totalCoinsSpent')}</p>
          </div>
          <div className="text-center p-4 bg-secondary/10 rounded-lg border border-secondary/20">
            <p className="text-3xl font-bold text-secondary">{stats.overall.totalMemes}</p>
            <p className="text-sm text-gray-600 dark:text-gray-400">{t('admin.totalMemes')}</p>
          </div>
        </div>
      </div>

      {/* Top Users */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-2xl font-bold mb-4">{t('admin.topUsersBySpending')}</h2>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b">
                <th className="text-left p-2">{t('admin.user')}</th>
                <th className="text-left p-2">{t('admin.activations')}</th>
                <th className="text-left p-2">{t('admin.totalCoins')}</th>
              </tr>
            </thead>
            <tbody>
              {stats.userSpending.map((item: any) => (
                <tr key={item.user.id} className="border-b">
                  <td className="p-2">{item.user.displayName}</td>
                  <td className="p-2">{item.activationsCount}</td>
                  <td className="p-2 font-bold text-accent">{item.totalCoinsSpent}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Top Memes */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-2xl font-bold mb-4">{t('admin.mostPopularMemes')}</h2>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b">
                <th className="text-left p-2">{t('admin.meme')}</th>
                <th className="text-left p-2">{t('admin.activations')}</th>
                <th className="text-left p-2">{t('admin.totalCoins')}</th>
              </tr>
            </thead>
            <tbody>
              {stats.memePopularity.map((item: any, index: number) => (
                <tr key={item.meme?.id || index} className="border-b">
                  <td className="p-2">{item.meme?.title || t('common.unknown') || 'Unknown'}</td>
                  <td className="p-2">{item.activationsCount}</td>
                  <td className="p-2 font-bold text-accent">{item.totalCoinsSpent}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// Promotion Management Component
function PromotionManagement() {
  const { t } = useTranslation();
  const [promotions, setPromotions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    discountPercent: '',
    startDate: '',
    endDate: '',
  });

  useEffect(() => {
    fetchPromotions();
  }, []);

  const fetchPromotions = async () => {
    try {
      setLoading(true);
      setError(null);
      const { api } = await import('../lib/api');
      const promotions = await api.get('/admin/promotions');
      setPromotions(promotions);
    } catch (error: any) {
      const errorMessage = error.response?.data?.error || 'Failed to load promotions';
      setError(errorMessage);
      toast.error(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const { api } = await import('../lib/api');
      await api.post('/admin/promotions', {
        name: formData.name,
        discountPercent: parseFloat(formData.discountPercent),
        startDate: new Date(formData.startDate).toISOString(),
        endDate: new Date(formData.endDate).toISOString(),
      });
      toast.success(t('admin.promotionCreated'));
      setShowCreateForm(false);
      setFormData({ name: '', discountPercent: '', startDate: '', endDate: '' });
      fetchPromotions();
    } catch (error: any) {
      toast.error(error.response?.data?.error || t('admin.failedToCreatePromotion') || 'Failed to create promotion');
    }
  };

  const handleToggleActive = async (id: string, currentActive: boolean) => {
    try {
      const { api } = await import('../lib/api');
      await api.patch(`/admin/promotions/${id}`, { isActive: !currentActive });
      toast.success(!currentActive ? t('admin.promotionActivated') : t('admin.promotionDeactivated'));
      fetchPromotions();
    } catch (error: any) {
      toast.error(error.response?.data?.error || t('admin.failedToUpdatePromotion') || 'Failed to update promotion');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm(t('admin.deletePromotion'))) return;
    try {
      const { api } = await import('../lib/api');
      await api.delete(`/admin/promotions/${id}`);
      toast.success(t('admin.promotionDeleted'));
      fetchPromotions();
    } catch (error: any) {
      toast.error(error.response?.data?.error || t('admin.failedToDeletePromotion') || 'Failed to delete promotion');
    }
  };

  if (loading) {
    return <div className="text-center py-8">{t('admin.loadingPromotions')}</div>;
  }

  if (error) {
    return (
      <div className="text-center py-8">
        <p className="text-red-600 dark:text-red-400 mb-4">{error}</p>
        <button
          onClick={fetchPromotions}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded"
        >
          Retry
        </button>
      </div>
    );
  }

  const now = new Date();

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-2xl font-bold">{t('admin.promotions')}</h2>
          <button
            onClick={() => setShowCreateForm(!showCreateForm)}
            className="bg-primary hover:bg-secondary text-white px-4 py-2 rounded transition-colors"
          >
            {showCreateForm ? t('common.cancel') : t('admin.createPromotion')}
          </button>
        </div>

        {showCreateForm && (
          <form onSubmit={handleCreate} className="mb-6 p-4 bg-gray-50 rounded-lg space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('admin.name')}</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                required
                className="w-full border border-gray-300 rounded-lg px-3 py-2"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('admin.discountPercent')}
              </label>
              <input
                type="number"
                value={formData.discountPercent}
                onChange={(e) => setFormData({ ...formData, discountPercent: e.target.value })}
                required
                min="0"
                max="100"
                step="0.1"
                className="w-full border border-gray-300 rounded-lg px-3 py-2"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('admin.startDate')}</label>
                <input
                  type="datetime-local"
                  value={formData.startDate}
                  onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                  required
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('admin.endDate')}</label>
                <input
                  type="datetime-local"
                  value={formData.endDate}
                  onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
                  required
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                />
              </div>
            </div>
            <button
              type="submit"
              className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded"
            >
              {t('admin.create')}
            </button>
          </form>
        )}

        <div className="space-y-4">
          {promotions.length === 0 ? (
            <div className="text-center py-8 text-gray-500">{t('admin.noPromotions')}</div>
          ) : (
            promotions.map((promo) => {
              const startDate = new Date(promo.startDate);
              const endDate = new Date(promo.endDate);
              const isCurrentlyActive = promo.isActive && now >= startDate && now <= endDate;
              
              return (
                <div
                  key={promo.id}
                  className={`p-4 border rounded-lg ${
                    isCurrentlyActive ? 'border-green-500 bg-green-50' : 'border-gray-300'
                  }`}
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <h3 className="font-semibold text-lg">{promo.name}</h3>
                      <p className="text-accent font-bold">{promo.discountPercent}% discount</p>
                      <p className="text-sm text-gray-600">
                        {startDate.toLocaleString()} - {endDate.toLocaleString()}
                      </p>
                      <div className="flex gap-2 mt-2">
                        <span
                        className={`px-2 py-1 rounded text-xs ${
                          promo.isActive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                        }`}
                      >
                        {promo.isActive ? t('admin.active') : t('admin.inactive')}
                      </span>
                      {isCurrentlyActive && (
                        <span className="px-2 py-1 rounded text-xs bg-green-200 text-green-900">
                          {t('admin.currentlyRunning')}
                        </span>
                      )}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleToggleActive(promo.id, promo.isActive)}
                        className={`px-3 py-1 rounded text-sm ${
                          promo.isActive
                            ? 'bg-yellow-600 hover:bg-yellow-700'
                            : 'bg-green-600 hover:bg-green-700'
                        } text-white`}
                      >
                        {promo.isActive ? t('admin.deactivate') : t('admin.activate')}
                      </button>
                      <button
                        onClick={() => handleDelete(promo.id)}
                        className="bg-red-600 hover:bg-red-700 text-white px-3 py-1 rounded text-sm"
                      >
                        {t('common.delete')}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

// Beta Access Management Component (Admin only)
function BetaAccessManagement() {
  const { t } = useTranslation();
  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadRequests();
  }, []);

  const loadRequests = async () => {
    try {
      setLoading(true);
      const requests = await api.get('/admin/beta/requests');
      setRequests(requests);
    } catch (error: any) {
      console.error('Error loading beta access requests:', error);
      toast.error(error.response?.data?.error || t('toast.failedToLoad'));
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (requestId: string) => {
    try {
      await api.post(`/admin/beta/requests/${requestId}/approve`);
      toast.success(t('toast.betaAccessApproved'));
      loadRequests();
    } catch (error: any) {
      toast.error(error.response?.data?.error || t('toast.failedToApprove'));
    }
  };

  const handleReject = async (requestId: string) => {
    try {
      await api.post(`/admin/beta/requests/${requestId}/reject`);
      toast.success(t('toast.betaAccessRejected'));
      loadRequests();
    } catch (error: any) {
      toast.error(error.response?.data?.error || t('toast.failedToReject'));
    }
  };

  const getStatusBadge = (status: string) => {
    const colors = {
      pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
      approved: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
      rejected: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
    };
    return (
      <span className={`px-2 py-1 rounded text-xs font-semibold ${colors[status as keyof typeof colors] || 'bg-gray-100 text-gray-800'}`}>
        {status}
      </span>
    );
  };

  if (loading) {
    return <div className="text-center py-8">{t('common.loading')}</div>;
  }

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold dark:text-white">{t('admin.betaAccessRequests')}</h2>
      
      {requests.length === 0 ? (
        <div className="text-center py-8 text-gray-500 dark:text-gray-400">
          {t('admin.noBetaAccessRequests')}
        </div>
      ) : (
        <div className="space-y-4">
          {requests.map((request: any) => (
            <div key={request.id} className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <div className="font-semibold text-gray-900 dark:text-white">
                    {request.user?.displayName || 'Unknown User'}
                  </div>
                  <div className="text-sm text-gray-500 dark:text-gray-400">
                    {request.user?.twitchUserId || 'N/A'}
                  </div>
                </div>
                {getStatusBadge(request.status)}
              </div>
              
              <div className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                <div>Requested: {new Date(request.requestedAt).toLocaleString()}</div>
                {request.approvedAt && (
                  <div>Processed: {new Date(request.approvedAt).toLocaleString()}</div>
                )}
              </div>

              {request.status === 'pending' && (
                <div className="flex gap-2">
                  <button
                    onClick={() => handleApprove(request.id)}
                    className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded transition-colors"
                  >
                    {t('admin.approve')}
                  </button>
                  <button
                    onClick={() => handleReject(request.id)}
                    className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded transition-colors"
                  >
                    {t('admin.reject')}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
