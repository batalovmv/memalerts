import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAppSelector, useAppDispatch } from '../store/hooks';
import { store } from '../store/index';
import { fetchSubmissions } from '../store/slices/submissionsSlice';
import Header from '../components/Header';
import SubmitModal from '../components/SubmitModal';

export default function Dashboard() {
  const { t } = useTranslation();
  const { user, loading: authLoading } = useAppSelector((state) => state.auth);
  const { submissions } = useAppSelector((state) => state.submissions);
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const [isSubmitModalOpen, setIsSubmitModalOpen] = useState(false);
  const submissionsLoadedRef = useRef(false);

  useEffect(() => {
    if (!authLoading && !user) {
      console.log('[Dashboard] No user, redirecting to /', { authLoading, user });
      navigate('/');
    }
  }, [user, authLoading, navigate]);

  // Removed role restrictions - Dashboard is accessible to all users

  // Load pending submissions if user is streamer/admin
  // Check Redux store with TTL to avoid duplicate requests on navigation
  useEffect(() => {
    if (user && (user.role === 'streamer' || user.role === 'admin') && user.channelId) {
      const currentState = store.getState();
      const submissionsState = currentState.submissions;
      const SUBMISSIONS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
      
      // Check if we have fresh data based on timestamp
      const hasFreshData = submissionsState.submissions.length > 0 && 
        submissionsState.lastFetchedAt !== null &&
        (Date.now() - submissionsState.lastFetchedAt) < SUBMISSIONS_CACHE_TTL;
      
      const isLoading = submissionsState.loading;
      
      // Only fetch if no fresh data and not loading
      if (!hasFreshData && !isLoading && !submissionsLoadedRef.current) {
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
  }, [user, user?.role, user?.channelId, dispatch]);

  const pendingSubmissionsCount = submissions.filter(s => s.status === 'pending').length;

  if (authLoading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-xl">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900">
      <Header />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <h1 className="text-3xl font-bold mb-2 dark:text-white">{t('dashboard.title', 'Dashboard')}</h1>
        <p className="text-gray-600 dark:text-gray-400 mb-8">
          {t('dashboard.subtitle', 'Manage your memes and channel settings')}
        </p>
        
        {user.channelId ? (
          <>
            {/* Wallet Balance - Prominent Display */}
            {user.wallets && user.wallets.length > 0 && (
              <div className="mb-8">
                <div className="bg-gradient-to-r from-purple-600 to-indigo-600 rounded-xl shadow-lg p-6 text-white">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-purple-100 text-sm mb-1">{t('dashboard.yourBalance', 'Your Balance')}</p>
                      <div className="text-4xl font-bold">
                        {user.wallets.find(w => w.channelId === user.channelId)?.balance || 0} 
                        <span className="text-2xl text-purple-200"> coins</span>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-purple-100 text-sm">
                        {t('dashboard.redeemChannelPoints', 'Redeem channel points on Twitch to earn more!')}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Quick Actions Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
              {/* Submit Meme Card - Primary */}
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 hover:shadow-2xl transition-shadow border-2 border-primary/20">
                <h2 className="text-2xl font-bold mb-4 dark:text-white">{t('dashboard.quickActions.submitMeme', 'Submit Meme')}</h2>
                <p className="text-gray-600 dark:text-gray-400 text-sm mb-4">
                  {t('dashboard.quickActions.submitMemeDescription', 'Add a meme directly to your pool')}
                </p>
                <button
                  onClick={() => setIsSubmitModalOpen(true)}
                  className="w-full bg-primary hover:bg-secondary text-white font-bold py-4 px-6 rounded-lg transition-colors text-lg shadow-lg"
                >
                  {t('dashboard.quickActions.submitMemeButton', 'Submit Meme')}
                </button>
              </div>

              {/* Pending Submissions Card - Secondary */}
              <div className={`bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 hover:shadow-lg transition-shadow ${
                pendingSubmissionsCount === 0 ? 'opacity-60' : ''
              }`}>
                <div className="flex items-center justify-between mb-2">
                  <h2 className="text-xl font-semibold dark:text-white">{t('dashboard.quickActions.pendingSubmissions', 'Pending Submissions')}</h2>
                  {pendingSubmissionsCount > 0 && (
                    <span className="bg-red-500 text-white text-sm font-bold rounded-full px-3 py-1">
                      {pendingSubmissionsCount}
                    </span>
                  )}
                </div>
                <p className="text-gray-600 dark:text-gray-400 text-sm mb-4">
                  {t('dashboard.quickActions.pendingSubmissionsDescription', 'Review and approve meme submissions')}
                </p>
                <button
                  onClick={() => navigate('/settings?tab=submissions')}
                  className={`w-full font-semibold py-3 px-6 rounded-lg transition-colors ${
                    pendingSubmissionsCount > 0
                      ? 'bg-red-500 hover:bg-red-600 text-white'
                      : 'bg-gray-300 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
                  }`}
                >
                  {pendingSubmissionsCount > 0 
                    ? t('dashboard.quickActions.pendingSubmissionsButton', `${pendingSubmissionsCount} Pending`, { count: pendingSubmissionsCount })
                    : t('dashboard.quickActions.noPendingSubmissions', 'No Pending')
                  }
                </button>
              </div>

              {/* Settings Card - Tertiary */}
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 hover:shadow-md transition-shadow opacity-90">
                <h2 className="text-lg font-medium mb-4 dark:text-white">{t('dashboard.quickActions.settings', 'Settings')}</h2>
                <p className="text-gray-600 dark:text-gray-400 text-sm mb-4">
                  {t('dashboard.quickActions.settingsDescription', 'Configure your channel and preferences')}
                </p>
                <button
                  onClick={() => navigate('/settings?tab=settings')}
                  className="w-full bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200 font-medium py-3 px-6 rounded-lg transition-colors"
                >
                  {t('dashboard.quickActions.settingsButton', 'Open Settings')}
                </button>
              </div>
            </div>

            {/* Additional Actions */}
            <div className="mb-6 flex flex-wrap gap-4">
              <button
                onClick={() => {
                  if (user.channel?.slug) {
                    navigate(`/channel/${user.channel.slug}`);
                  }
                }}
                className="bg-primary hover:bg-secondary text-white font-semibold py-2 px-6 rounded-lg transition-colors"
              >
                {t('dashboard.viewPublicProfile')}
              </button>
            </div>
          </>
        ) : (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6">
            <p className="text-gray-600 dark:text-gray-400">
              {t('dashboard.noChannel', 'You don\'t have a channel yet. Create one to start using the platform.')}
            </p>
          </div>
        )}
      </main>

      {/* Submit Modal */}
      {user.channelId && (
        <SubmitModal
          isOpen={isSubmitModalOpen}
          onClose={() => setIsSubmitModalOpen(false)}
          channelSlug={user.channel?.slug}
          channelId={user.channelId}
        />
      )}
    </div>
  );
}
