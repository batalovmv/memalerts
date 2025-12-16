import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAppSelector } from '../store/hooks';
import Header from '../components/Header';
import toast from 'react-hot-toast';

export default function Dashboard() {
  const { t } = useTranslation();
  const { user, loading: authLoading } = useAppSelector((state) => state.auth);
  const navigate = useNavigate();

  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/');
    }
  }, [user, authLoading, navigate]);

  useEffect(() => {
    if (user && user.role === 'streamer' && !user.channelId) {
      // If user is streamer but no channelId, redirect to home
      navigate('/');
    } else if (user && user.role !== 'streamer') {
      // If user is not streamer, redirect to home
      navigate('/');
    }
  }, [user, navigate]);

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
        {user.channelId && (
          <>
            <div className="mb-6">
              <h2 className="text-2xl font-bold mb-2">{t('dashboard.profileLink')}</h2>
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
                <div className="flex items-center gap-4">
                  <input
                    type="text"
                    readOnly
                    value={`https://twitchmemes.ru/channel/${user.channel?.slug || ''}`}
                    className="flex-1 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-2 bg-gray-50 dark:bg-gray-700"
                  />
                  <button
                    onClick={async () => {
                      const url = `https://twitchmemes.ru/channel/${user.channel?.slug || ''}`;
                      try {
                        await navigator.clipboard.writeText(url);
                        toast.success(t('toast.linkCopied'));
                      } catch (error) {
                        toast.error(t('toast.failedToCopyLink'));
                      }
                    }}
                    className="bg-primary hover:bg-secondary text-white font-semibold py-2 px-4 rounded-lg transition-colors"
                  >
                    {t('dashboard.copyLink')}
                  </button>
                </div>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
                  {t('dashboard.shareLinkDescription')}
                </p>
              </div>
            </div>
            <div className="mb-6">
              <h2 className="text-2xl font-bold mb-2 dark:text-white">{t('dashboard.wallet')}</h2>
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
                <div className="text-3xl font-bold text-accent">
                  {user.wallets?.find(w => w.channelId === user.channelId)?.balance || 0} {t('dashboard.balance')}
                </div>
                <p className="text-gray-600 dark:text-gray-400 mt-2">
                  {t('profile.redeemPoints')}
                </p>
              </div>
            </div>
            
            {/* Action Buttons */}
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
              <button
                onClick={() => navigate('/settings?tab=settings')}
                className="bg-secondary hover:bg-primary text-white font-semibold py-2 px-6 rounded-lg transition-colors border border-secondary"
              >
                {t('userMenu.settings')}
              </button>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
