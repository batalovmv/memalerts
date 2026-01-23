import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';

import UserMenu from '@/components/UserMenu';
import { login } from '@/lib/auth';
import { useAuthQueryErrorToast } from '@/shared/auth/useAuthQueryErrorToast';
import { Button, Card, Spinner } from '@/shared/ui';
import { useAppSelector } from '@/store/hooks';

export default function Landing() {
  const { user, loading } = useAppSelector((state) => state.auth);
  const navigate = useNavigate();
  const { t } = useTranslation();

  useAuthQueryErrorToast();

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

  // OAuth error handling is handled by useAuthQueryErrorToast.

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex items-center gap-3 text-gray-200">
          <Spinner className="h-5 w-5 border-white/30 border-t-white/90" />
          <div className="text-base font-semibold">{t('common.loading', { defaultValue: 'Loading…' })}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-900">
      {user && (
        <nav className="bg-white/10 backdrop-blur-sm border-b border-white/10">
          <div className="page-container">
            <div className="flex justify-end h-16 items-center">
              <UserMenu />
            </div>
          </div>
        </nav>
      )}

      {/* Background accents (subtle iOS/glass vibe) */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        <div className="absolute -top-32 -left-32 h-80 w-80 rounded-full bg-primary/25 blur-3xl" />
        <div className="absolute top-24 -right-32 h-80 w-80 rounded-full bg-secondary/20 blur-3xl" />
        <div className="absolute bottom-0 left-1/2 h-96 w-[36rem] -translate-x-1/2 rounded-full bg-accent/15 blur-3xl" />
      </div>

      <main className="relative flex flex-col items-center justify-center min-h-screen py-10 sm:py-14">
        <div className="w-full max-w-4xl px-4 sm:px-6">
          <div className="section-gap">
            {/* Main CTA Card */}
            <Card className="glass p-8 sm:p-10 text-center">
              <h1 className="text-4xl sm:text-5xl font-bold text-white tracking-tight">
                {t('landing.title')}
              </h1>
              <p className="mt-4 text-white/80 text-base sm:text-lg">
                {t('landing.subtitle')}
              </p>

              {!user && (
                <div className="mt-8 flex flex-col items-stretch gap-3">
                  <Button
                    onClick={() => login()}
                    variant="primary"
                    size="lg"
                    className="w-full justify-center"
                    aria-label={t('landing.login')}
                  >
                    {t('landing.login')}
                  </Button>

                  <p className="text-white/70 text-xs">
                    {t('landing.agreeTo', { defaultValue: 'By continuing you agree to our' })}{' '}
                    <Link to="/terms" className="link-soft hover:text-white">
                      {t('landing.terms', { defaultValue: 'Terms of Service' })}
                    </Link>{' '}
                    {t('landing.and', { defaultValue: 'and' })}{' '}
                    <Link to="/privacy" className="link-soft hover:text-white">
                      {t('landing.privacy', { defaultValue: 'Privacy Policy' })}
                    </Link>
                    .
                  </p>
                </div>
              )}
            </Card>

            {/* How It Works Section */}
            <Card className="glass p-8 sm:p-10">
              <h2 className="text-3xl sm:text-4xl font-bold text-white text-center tracking-tight">
                {t('landing.howItWorks')}
              </h2>

              <div className="mt-8 grid md:grid-cols-2 gap-6 sm:gap-8">
                {/* For Viewers */}
                <Card className="bg-white/5 p-6" aria-label={t('landing.forViewers')}>
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
                </Card>

                {/* For Streamers */}
                <Card className="bg-white/5 p-6" aria-label={t('landing.forStreamers')}>
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
                </Card>
              </div>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}

