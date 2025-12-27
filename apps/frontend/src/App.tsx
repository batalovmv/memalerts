import { Suspense, lazy, useEffect, useState } from 'react';
import { Toaster } from 'react-hot-toast';
import { Route, Routes, useLocation } from 'react-router-dom';

import AdminRedirect from './components/AdminRedirect';
import BetaAccessRequest from './components/BetaAccessRequest';
import Footer from './components/Footer';
import GlobalErrorBanner from './components/GlobalErrorBanner';
import { SocketProvider } from './contexts/SocketContext';
import { api } from './lib/api';
import { Spinner } from './shared/ui';
import { useAppDispatch, useAppSelector } from './store/hooks';
import { fetchUser } from './store/slices/authSlice';

const Landing = lazy(() => import('./pages/Landing'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const StreamerProfile = lazy(() => import('./pages/StreamerProfile'));
const Submit = lazy(() => import('./pages/Submit'));
const Admin = lazy(() => import('./pages/Admin'));
const Search = lazy(() => import('./pages/Search'));
const Pool = lazy(() => import('./pages/Pool'));
const TermsOfService = lazy(() => import('./pages/TermsOfService'));
const PrivacyPolicy = lazy(() => import('./pages/PrivacyPolicy'));
const BetaAccess = lazy(() => import('./pages/BetaAccess'));
const PostLogin = lazy(() => import('./pages/PostLogin'));

function App() {
  const dispatch = useAppDispatch();
  const { user } = useAppSelector((state) => state.auth);
  const [betaChecked, setBetaChecked] = useState(false);
  const [betaHasAccess, setBetaHasAccess] = useState<boolean>(true);
  const location = useLocation();

  useEffect(() => {
    dispatch(fetchUser());
  }, [dispatch]);

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

  return (
    <SocketProvider>
      <Toaster position="top-right" />
      <GlobalErrorBanner />
      <div className="relative flex flex-col min-h-screen overflow-x-hidden">
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
        <div className="flex-1 flex flex-col">
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
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/channel/:slug" element={<StreamerProfile />} />
              <Route path="/submit" element={<Submit />} />
              <Route path="/settings/*" element={<Admin />} />
              <Route path="/admin" element={<AdminRedirect />} />
              <Route path="/search" element={<Search />} />
              <Route path="/pool" element={<Pool />} />
              <Route path="/beta-access" element={<BetaAccess />} />
              <Route path="/terms" element={<TermsOfService />} />
              <Route path="/privacy" element={<PrivacyPolicy />} />
            </Routes>
          </Suspense>
        </div>
        <Footer />
      </div>
    </SocketProvider>
  );
}

export default App;


