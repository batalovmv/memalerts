import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppSelector, useAppDispatch } from '../store/hooks';
import { logout } from '../store/slices/authSlice';
import toast from 'react-hot-toast';

export default function UserMenu() {
  const { user } = useAppSelector((state) => state.auth);
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  if (!user) {
    return null;
  }

  const handleLogout = async () => {
    try {
      await dispatch(logout()).unwrap();
      navigate('/');
      toast.success('Logged out successfully');
    } catch (error) {
      toast.error('Failed to logout');
    }
  };

  const handleMyProfile = () => {
    if (user.role === 'streamer' && user.channelId) {
      // Get channel slug from user data or fetch it
      // For now, redirect to dashboard - we'll improve this later
      navigate('/dashboard');
    } else {
      navigate('/dashboard');
    }
    setIsOpen(false);
  };

  const handleSubmitMeme = () => {
    navigate('/submit');
    setIsOpen(false);
  };

  const handleAdmin = () => {
    navigate('/admin');
    setIsOpen(false);
  };

  // Get balance for user's channel if available
  const userBalance = user.channelId && user.wallets
    ? user.wallets.find(w => w.channelId === user.channelId)?.balance || 0
    : 0;

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-100 transition-colors"
      >
        {/* Avatar placeholder - will be replaced with Twitch avatar later */}
        <div className="w-8 h-8 rounded-full bg-purple-600 flex items-center justify-center text-white font-semibold">
          {user.displayName.charAt(0).toUpperCase()}
        </div>
        <span className="text-sm font-medium text-gray-700">{user.displayName}</span>
        {userBalance > 0 && (
          <span className="text-xs text-gray-500">({userBalance} coins)</span>
        )}
        <svg
          className={`w-4 h-4 text-gray-500 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-56 bg-white rounded-lg shadow-lg border border-gray-200 py-2 z-50">
          {/* User info header */}
          <div className="px-4 py-3 border-b border-gray-200">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-purple-600 flex items-center justify-center text-white font-semibold">
                {user.displayName.charAt(0).toUpperCase()}
              </div>
              <div>
                <div className="font-medium text-gray-900">{user.displayName}</div>
                <div className="text-sm text-gray-500">{user.role}</div>
              </div>
            </div>
          </div>

          {/* Menu items */}
          <div className="py-1">
            {(user.role === 'streamer' || user.role === 'admin') && (
              <button
                onClick={handleMyProfile}
                className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 transition-colors"
              >
                My Profile
              </button>
            )}
            <button
              onClick={handleSubmitMeme}
              className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 transition-colors"
            >
              Submit Meme
            </button>
            {(user.role === 'streamer' || user.role === 'admin') && (
              <button
                onClick={handleAdmin}
                className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 transition-colors"
              >
                Admin Panel
              </button>
            )}
          </div>

          {/* Divider */}
          <div className="border-t border-gray-200 my-1"></div>

          {/* Logout */}
          <button
            onClick={handleLogout}
            className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors"
          >
            Logout
          </button>
        </div>
      )}
    </div>
  );
}

