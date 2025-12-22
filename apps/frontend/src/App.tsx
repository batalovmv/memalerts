import { useEffect, useState } from 'react';
import { Routes, Route } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { useAppDispatch } from './store/hooks';
import { fetchUser } from './store/slices/authSlice';
import { SocketProvider } from './contexts/SocketContext';
import Landing from './pages/Landing';
import Dashboard from './pages/Dashboard';
import StreamerProfile from './pages/StreamerProfile';
import Submit from './pages/Submit';
import Admin from './pages/Admin';
import Search from './pages/Search';
import TermsOfService from './pages/TermsOfService';
import PrivacyPolicy from './pages/PrivacyPolicy';
import BetaAccess from './pages/BetaAccess';
import Footer from './components/Footer';
import AdminRedirect from './components/AdminRedirect';
import BetaAccessRequest from './components/BetaAccessRequest';
import { useAppSelector } from './store/hooks';
import { api } from './lib/api';
import GlobalErrorBanner from './components/GlobalErrorBanner';

function App() {
  const dispatch = useAppDispatch();
  const { user } = useAppSelector((state) => state.auth);
  const [betaChecked, setBetaChecked] = useState(false);
  const [betaHasAccess, setBetaHasAccess] = useState<boolean>(true);

  useEffect(() => {
    dispatch(fetchUser());
  }, [dispatch]);

  // Check if we're on beta domain
  const isBetaDomain = window.location.hostname.includes('beta.');

  // On beta, block the entire app UI unless user has beta access.
  // Backend allows only /me and /beta/* without access; everything else is 403.
  useEffect(() => {
    if (!isBetaDomain) return;
    if (!user) {
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
  }, [isBetaDomain, user]);

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

  return (
    <SocketProvider>
      <Toaster position="top-right" />
      <GlobalErrorBanner />
      <div className="flex flex-col min-h-screen overflow-x-hidden">
        <div className="flex-1">
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/channel/:slug" element={<StreamerProfile />} />
            <Route path="/submit" element={<Submit />} />
            <Route path="/settings" element={<Admin />} />
            <Route path="/admin" element={<AdminRedirect />} />
            <Route path="/search" element={<Search />} />
            <Route path="/beta-access" element={<BetaAccess />} />
            <Route path="/terms" element={<TermsOfService />} />
            <Route path="/privacy" element={<PrivacyPolicy />} />
          </Routes>
        </div>
        <Footer />
      </div>
    </SocketProvider>
  );
}

export default App;


