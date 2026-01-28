import { Suspense, lazy, useEffect, useState } from 'react';
import { Toaster } from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';

import { SocketProvider } from './contexts/SocketContext';
import { api } from './lib/api';
import { DockPage } from './pages/DockPage';
import { Spinner } from './shared/ui';
import { useAppDispatch, useAppSelector } from './store/hooks';
import { fetchUser, setUnauthenticated } from './store/slices/authSlice';

import BetaAccessRequest from '@/features/beta-access/ui/BetaAccessRequest';
import AdminRedirect from '@/features/settings/ui/AdminRedirect';
import { getEffectiveUserMode } from '@/shared/lib/uiMode';
import { setStoredUserMode } from '@/shared/lib/userMode';
import { getViewerHome, setViewerHome } from '@/shared/lib/viewerHome';
import GlobalErrorBanner from '@/shared/ui/GlobalErrorBanner';
import Footer from '@/widgets/footer/Footer';

const Landing = lazy(() => import('./pages/Landing'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const StreamerProfile = lazy(() => import('./pages/StreamerProfile'));
const Submit = lazy(() => import('./pages/Submit'));
const Admin = lazy(() => import('./pages/Admin'));
const Search = lazy(() => import('./pages/Search'));
const Pool = lazy(() => import('./pages/Pool'));
const Moderation = lazy(() => import('./pages/Moderation'));
const TermsOfService = lazy(() => import('./pages/TermsOfService'));
const PrivacyPolicy = lazy(() => import('./pages/PrivacyPolicy'));
const BetaAccess = lazy(() => import('./pages/BetaAccess'));
const PostLogin = lazy(() => import('./pages/PostLogin'));

function App() {
  const dispatch = useAppDispatch();
  const { t } = useTranslation();
  const { user, loading: authLoading } = useAppSelector((state) => state.auth);
  const [betaChecked, setBetaChecked] = useState(false);
  const [betaHasAccess, setBetaHasAccess] = useState<boolean>(true);
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    dispatch(fetchUser());
  }, [dispatch]);

  // If any API call returns 401, clear auth state so we don't end up with "avatar menu + login required screen"
  // (stale UI) at the same time.
  useEffect(() => {
    let lastAt = 0;
    const onUnauthorized = () => {
      const now = Date.now();
      // Cheap debounce: multiple parallel requests can fail with 401 at once.
      if (now - lastAt < 500) return;
      lastAt = now;
      dispatch(setUnauthenticated());
    };

    window.addEventListener('memalerts:auth:unauthorized', onUnauthorized as EventListener);
    return () => window.removeEventListener('memalerts:auth:unauthorized', onUnauthorized as EventListener);
  }, [dispatch]);

  // Post-OAuth reliable return: some backend deployments may ignore redirect_to and send user to /settings/accounts.
  // If we have a stored intended returnTo, redirect once after /me succeeds.
  useEffect(() => {
    if (!user) return;

    let returnTo: string | null = null;
    let mode: string | null = null;
    let setAt: number | null = null;
    try {
      returnTo = sessionStorage.getItem('memalerts:auth:returnTo');
      mode = sessionStorage.getItem('memalerts:auth:mode');
      setAt = Number(sessionStorage.getItem('memalerts:auth:setAt') || '0') || null;
    } catch {
      returnTo = null;
    }

    if (!returnTo && !mode) return;

    const ttlMs = 2 * 60_000;
    if (!setAt || Date.now() - setAt > ttlMs) {
      try {
        sessionStorage.removeItem('memalerts:auth:returnTo');
        sessionStorage.removeItem('memalerts:auth:mode');
        sessionStorage.removeItem('memalerts:auth:setAt');
      } catch {
        // ignore
      }
      return;
    }

    const currentUrl = `${location.pathname}${location.search}`;
    const returnToPath = returnTo ? returnTo.split('?')[0] : null;

    const validMode = mode === 'viewer' || mode === 'streamer' ? (mode as 'viewer' | 'streamer') : null;
    if (validMode) {
      setStoredUserMode(validMode);

      // If login started from a public channel page, remember it as a "viewer home" to keep navigation consistent.
      // (We intentionally keep it in sessionStorage: it's contextual to the current login/tab.)
      if (validMode === 'viewer' && returnToPath && returnToPath.startsWith('/channel/')) {
        if (returnTo) setViewerHome(returnTo);
      }
    }

    // If backend ignored redirect_to and sent user to settings/accounts, bring them back once.
    // Otherwise, if we are already on the intended returnTo, clear the stored values to avoid future hijacks.
    const shouldRedirectFromAccounts = location.pathname === '/settings/accounts' && !!returnTo;
    const isAlreadyAtReturnTo = !!returnTo && currentUrl === returnTo;

    if (shouldRedirectFromAccounts || isAlreadyAtReturnTo) {
      // Clear first to avoid loops / future hijacks.
      try {
        sessionStorage.removeItem('memalerts:auth:returnTo');
        sessionStorage.removeItem('memalerts:auth:mode');
        sessionStorage.removeItem('memalerts:auth:setAt');
      } catch {
        // ignore
      }
    }

    if (shouldRedirectFromAccounts && returnTo) {
      navigate(returnTo, { replace: true });
    }
  }, [location.pathname, location.search, navigate, user]);

  // Check if we're on beta domain
  const isBetaDomain = window.location.hostname.includes('beta.');
  const isLoggedIn = !!user;
  const userId = user?.id ?? null;

  // On beta, block the entire app UI unless user has beta access.
  // Backend allows only /me and /beta/* without access; everything else is 403.
  useEffect(() => {
    if (!isBetaDomain) return;
    if (!isLoggedIn) {
      setBetaChecked(true);
      setBetaHasAccess(true); // not logged in -> landing page still usable
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const res = await api.get<{ hasAccess: boolean }>('/beta/status', { timeout: 10000 });
        if (cancelled) return;
        setBetaHasAccess(!!res?.hasAccess);
      } catch (e) {
        if (cancelled) return;
        // If status check fails, be safe: treat as no access.
        setBetaHasAccess(false);
      } finally {
        if (!cancelled) setBetaChecked(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isBetaDomain, isLoggedIn, userId]);

  // Beta gating: only show access request screen (after login) until approved.
  if (isBetaDomain && user && betaChecked && !betaHasAccess) {
    return (
      <>
        <Toaster position="top-right" />
        <GlobalErrorBanner />
        <BetaAccessRequest />
      </>
    );
  }

  // Public channel pages already provide their own full-screen background.
  const showGlobalBackground = !location.pathname.startsWith('/channel/');
  const uiMode = getEffectiveUserMode(user);
  const viewerHome = getViewerHome() || (user?.channel?.slug ? `/channel/${user.channel.slug}` : '/search');
  const dashboardElement = authLoading ? (
    <div className="min-h-[50vh] flex items-center justify-center gap-3 text-gray-600 dark:text-gray-300">
      <Spinner className="h-5 w-5" />
      <span>Loading...</span>
    </div>
  ) : uiMode === 'viewer' ? (
    <Navigate to={viewerHome} replace />
  ) : (
    <Dashboard />
  );

  return (
    <SocketProvider>
      <Toaster position="top-right" />
      <GlobalErrorBanner />
      <div className="relative flex flex-col min-h-screen overflow-x-hidden">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:px-4 focus:py-2 focus:rounded-md focus:bg-white focus:text-gray-900 focus:shadow-lg"
        >
          {t('common.skipToContent', { defaultValue: 'Skip to content' })}
        </a>
        {showGlobalBackground ? (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0"
            style={{
              backgroundImage: [
                `radial-gradient(70% 60% at 14% 12%, color-mix(in srgb, var(--primary-color) 14%, transparent) 0%, transparent 62%)`,
                `radial-gradient(60% 55% at 88% 16%, color-mix(in srgb, var(--secondary-color) 12%, transparent) 0%, transparent 64%)`,
                `radial-gradient(70% 60% at 55% 90%, color-mix(in srgb, var(--accent-color) 10%, transparent) 0%, transparent 64%)`,
                `linear-gradient(135deg, color-mix(in srgb, var(--primary-color) 8%, transparent) 0%, transparent 45%, color-mix(in srgb, var(--secondary-color) 8%, transparent) 100%)`,
              ].join(', '),
            }}
          />
        ) : null}
        <main id="main-content" className="flex-1 flex flex-col">
          <Suspense
            fallback={
              <div className="min-h-[50vh] flex items-center justify-center gap-3 text-gray-600 dark:text-gray-300">
                <Spinner className="h-5 w-5" />
                <span>Loading…</span>
              </div>
            }
          >
            <Routes>
              <Route path="/" element={<Landing />} />
              <Route path="/post-login" element={<PostLogin />} />
              <Route path="/dashboard" element={dashboardElement} />
              <Route path="/channel/:slug" element={<StreamerProfile />} />
              <Route path="/submit" element={<Submit />} />
              <Route path="/settings/*" element={<Admin />} />
              <Route path="/admin" element={uiMode === 'viewer' ? <Navigate to={viewerHome} replace /> : <AdminRedirect />} />
              <Route path="/search" element={<Search />} />
              <Route path="/pool" element={<Pool />} />
              <Route path="/moderation" element={<Moderation />} />
              <Route path="/dock" element={<DockPage />} />
              <Route path="/beta-access" element={<BetaAccess />} />
              <Route path="/terms" element={<TermsOfService />} />
              <Route path="/privacy" element={<PrivacyPolicy />} />
            </Routes>
          </Suspense>
        </main>
        <Footer />
      </div>
    </SocketProvider>
  );
}

export default App;
