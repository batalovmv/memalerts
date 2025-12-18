import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAppSelector } from '../store/hooks';
import { login } from '../lib/auth';
import UserMenu from '../components/UserMenu';
import toast from 'react-hot-toast';

export default function Landing() {
  const { user, loading } = useAppSelector((state) => state.auth);
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && user) {
      // Backend already redirected to the correct path (including redirectTo from state)
      // Check current pathname - if we're on Landing page, redirect appropriately
      const currentPath = window.location.pathname;
      
      // If we're already on a specific page (not landing), don't redirect
      if (currentPath !== '/' && currentPath !== '') {
        // User is already on the correct page (backend redirected them)
        return;
      }
      
      // If we're on landing page and user is logged in, redirect to dashboard or home
      // (This handles cases where user navigated directly to /)
      if (user.channelId && user.channel?.slug) {
        navigate('/dashboard');
      } else {
        // User without channel stays on landing or goes to home
        // Don't redirect - let them see the landing page
      }
    }
  }, [user, loading, navigate]);

  useEffect(() => {
    // Check for OAuth error in URL parameters
    const error = searchParams.get('error');
    const reason = searchParams.get('reason');
    const details = searchParams.get('details');

    if (error === 'auth_failed') {
      let errorMessage = 'Authentication failed. Please try again.';
      
      if (reason) {
        switch (reason) {
          case 'no_client_id':
            errorMessage = 'Authentication error: Client ID not configured.';
            break;
          case 'no_callback_url':
            errorMessage = 'Authentication error: Callback URL not configured.';
            break;
          case 'no_code':
            errorMessage = 'Authentication error: No authorization code received.';
            break;
          case 'no_token':
            errorMessage = 'Authentication error: Failed to get access token.';
            break;
          case 'no_user':
            errorMessage = 'Authentication error: Failed to get user information.';
            break;
          case 'user_null':
            errorMessage = 'Authentication error: User creation failed.';
            break;
          case 'exception':
            if (details) {
              try {
                const decodedDetails = decodeURIComponent(details);
                errorMessage = `Authentication error: ${decodedDetails}`;
              } catch (e) {
                errorMessage = 'Authentication error: An unexpected error occurred.';
              }
            } else {
              errorMessage = 'Authentication error: An unexpected error occurred.';
            }
            break;
          default:
            errorMessage = `Authentication failed: ${reason}`;
        }
      }
      
      setAuthError(errorMessage);
      toast.error(errorMessage);
      
      // Remove error parameters from URL
      const newSearchParams = new URLSearchParams(searchParams);
      newSearchParams.delete('error');
      newSearchParams.delete('reason');
      newSearchParams.delete('details');
      setSearchParams(newSearchParams, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-xl">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-900">
      {user && (
        <nav className="bg-white/10 backdrop-blur-sm">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-end h-16 items-center">
              <UserMenu />
            </div>
          </div>
        </nav>
      )}
      <div className="flex flex-col items-center justify-center min-h-screen py-12">
        <div className="max-w-4xl w-full px-4">
          {/* Main CTA Card */}
          <div className="bg-white/10 backdrop-blur-lg rounded-2xl shadow-2xl p-8 text-center mb-8">
            <h1 className="text-4xl font-bold text-white mb-4">{t('landing.title')}</h1>
            <p className="text-white/80 mb-8">
              {t('landing.subtitle')}
            </p>
            {!user && (
              <>
                {authError && (
                  <div className="mb-4 p-3 bg-red-500/20 border border-red-500/50 rounded-lg text-red-200 text-sm">
                    {authError}
                  </div>
                )}
                <button
                  onClick={() => login()}
                  className="w-full bg-primary hover:bg-secondary text-white font-semibold py-3 px-6 rounded-lg transition-colors mb-4"
                >
                  {t('landing.login')}
                </button>
                <p className="text-white/60 text-xs">
                  {t('landing.terms')}{' '}
                  <a href="/terms" className="underline hover:text-white">
                    {t('landing.terms')}
                  </a>
                </p>
              </>
            )}
          </div>

          {/* How It Works Section */}
          <div className="bg-white/10 backdrop-blur-lg rounded-2xl shadow-2xl p-8">
            <h2 className="text-3xl font-bold text-white mb-8 text-center">{t('landing.howItWorks')}</h2>
            
            <div className="grid md:grid-cols-2 gap-8">
              {/* For Viewers */}
              <div className="bg-white/5 rounded-lg p-6">
                <h3 className="text-xl font-semibold text-white mb-4">{t('landing.forViewers')}</h3>
                <ul className="space-y-3 text-white/80 text-sm">
                  <li className="flex items-start gap-2">
                    <span className="text-primary font-bold">1.</span>
                    <span>{t('landing.viewerStep1')}</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-primary font-bold">2.</span>
                    <span>{t('landing.viewerStep2')}</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-primary font-bold">3.</span>
                    <span>{t('landing.viewerStep3')}</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-primary font-bold">4.</span>
                    <span>{t('landing.viewerStep4')}</span>
                  </li>
                </ul>
              </div>

              {/* For Streamers */}
              <div className="bg-white/5 rounded-lg p-6">
                <h3 className="text-xl font-semibold text-white mb-4">{t('landing.forStreamers')}</h3>
                <ul className="space-y-3 text-white/80 text-sm">
                  <li className="flex items-start gap-2">
                    <span className="text-primary font-bold">1.</span>
                    <span>{t('landing.streamerStep1')}</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-primary font-bold">2.</span>
                    <span>{t('landing.streamerStep2')}</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-primary font-bold">3.</span>
                    <span>{t('landing.streamerStep3')}</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-primary font-bold">4.</span>
                    <span>{t('landing.streamerStep4')}</span>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
