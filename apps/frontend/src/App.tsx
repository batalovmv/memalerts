import { useEffect } from 'react';
import { Routes, Route } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { useAppDispatch } from './store/hooks';
import { fetchUser } from './store/slices/authSlice';
import Landing from './pages/Landing';
import Dashboard from './pages/Dashboard';
import StreamerProfile from './pages/StreamerProfile';
import Submit from './pages/Submit';
import Admin from './pages/Admin';
import Search from './pages/Search';
import TermsOfService from './pages/TermsOfService';
import PrivacyPolicy from './pages/PrivacyPolicy';
import Footer from './components/Footer';

function App() {
  const dispatch = useAppDispatch();

  useEffect(() => {
    dispatch(fetchUser());
  }, [dispatch]);

  return (
    <>
      <Toaster position="top-right" />
      <div className="flex flex-col min-h-screen">
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/channel/:slug" element={<StreamerProfile />} />
          <Route path="/submit" element={<Submit />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="/search" element={<Search />} />
          <Route path="/terms" element={<TermsOfService />} />
          <Route path="/privacy" element={<PrivacyPolicy />} />
        </Routes>
        <Footer />
      </div>
    </>
  );
}

export default App;


