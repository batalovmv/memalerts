import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppSelector } from '../store/hooks';
import { login } from '../lib/auth';
import UserMenu from '../components/UserMenu';

export default function Landing() {
  const { user, loading } = useAppSelector((state) => state.auth);
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && user) {
      navigate('/dashboard');
    }
  }, [user, loading, navigate]);

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
      <div className="flex items-center justify-center min-h-screen">
        <div className="max-w-md w-full bg-white/10 backdrop-blur-lg rounded-2xl shadow-2xl p-8 text-center">
          <h1 className="text-4xl font-bold text-white mb-4">Channel Points Mem Alerts</h1>
          <p className="text-white/80 mb-8">
            Spend your Twitch channel points to activate memes on stream!
          </p>
          {!user && (
            <button
              onClick={login}
              className="w-full bg-purple-600 hover:bg-purple-700 text-white font-semibold py-3 px-6 rounded-lg transition-colors"
            >
              Login with Twitch
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
