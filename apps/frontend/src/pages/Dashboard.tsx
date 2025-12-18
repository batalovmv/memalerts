import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAppSelector, useAppDispatch } from '../store/hooks';
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

  useEffect(() => {
    if (!authLoading && !user) {
      console.log('[Dashboard] No user, redirecting to /', { authLoading, user });
      navigate('/');
    }
  }, [user, authLoading, navigate]);

  // Removed role restrictions - Dashboard is accessible to all users

  // Load pending submissions if user is streamer/admin
  useEffect(() => {
    if (user && (user.role === 'streamer' || user.role === 'admin') && user.channelId) {
      dispatch(fetchSubmissions({ status: 'pending' }));
    }
  }, [user, dispatch]);

  const pendingSubmissionsCount = submissions.filter(s => s.status === 'pending').length;
  const isOwner = user && user.channelId && user.channelId === user.channelId;

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
        <h1 className="text-3xl font-bold mb-8 dark:text-white">{t('dashboard.title', 'Dashboard')}</h1>
        
        {user.channelId ? (
          <>
            {/* Quick Actions Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
              {/* Submit Meme Card */}
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6 hover:shadow-xl transition-shadow">
                <h2 className="text-xl font-semibold mb-4 dark:text-white">{t('dashboard.quickActions.submitMeme', 'Submit Meme')}</h2>
                <p className="text-gray-600 dark:text-gray-400 text-sm mb-4">
                  {t('dashboard.quickActions.submitMemeDescription', 'Add a meme directly to your pool')}
                </p>
                <button
                  onClick={() => setIsSubmitModalOpen(true)}
                  className="w-full bg-primary hover:bg-secondary text-white font-semibold py-3 px-6 rounded-lg transition-colors"
                >
                  {t('dashboard.quickActions.submitMemeButton', 'Submit Meme')}
                </button>
              </div>

              {/* Pending Submissions Card */}
              <div className={`bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6 hover:shadow-xl transition-shadow ${
                pendingSubmissionsCount === 0 ? 'opacity-60' : ''
              }`}>
                <h2 className="text-xl font-semibold mb-4 dark:text-white">{t('dashboard.quickActions.pendingSubmissions', 'Pending Submissions')}</h2>
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
                    ? t('dashboard.quickActions.pendingSubmissionsButton', { count: pendingSubmissionsCount }, `${pendingSubmissionsCount} Pending`)
                    : t('dashboard.quickActions.noPendingSubmissions', 'No Pending')
                  }
                </button>
              </div>

              {/* Settings Card */}
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6 hover:shadow-xl transition-shadow">
                <h2 className="text-xl font-semibold mb-4 dark:text-white">{t('dashboard.quickActions.settings', 'Settings')}</h2>
                <p className="text-gray-600 dark:text-gray-400 text-sm mb-4">
                  {t('dashboard.quickActions.settingsDescription', 'Configure your channel and preferences')}
                </p>
                <button
                  onClick={() => navigate('/settings?tab=settings')}
                  className="w-full bg-secondary hover:bg-primary text-white font-semibold py-3 px-6 rounded-lg transition-colors"
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
