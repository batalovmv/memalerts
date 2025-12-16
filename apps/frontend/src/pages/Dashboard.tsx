import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAppSelector } from '../store/hooks';
import Header from '../components/Header';

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
