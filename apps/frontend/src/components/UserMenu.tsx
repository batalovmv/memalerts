import { useState, useRef, useEffect } from 'react';
import { useNavigate, useLocation, useParams } from 'react-router-dom';
import { useAppSelector, useAppDispatch } from '../store/hooks';
import { logout } from '../store/slices/authSlice';
import toast from 'react-hot-toast';

export default function UserMenu() {
  const { user } = useAppSelector((state) => state.auth);
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams<{ slug: string }>();
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

  // Determine displayed role based on context
  // Show "streamer" only when viewing own profile, "viewer" when viewing someone else's profile
  const getDisplayRole = (): string => {
    // If on channel profile page
    if (location.pathname.startsWith('/channel/') && params.slug) {
      // Check if this is the user's own channel
      if (user.channel?.slug === params.slug) {
        return 'streamer';
      } else {
        // Viewing someone else's channel
        return 'viewer';
      }
    }
    // On other pages (dashboard, admin, etc.), show actual role
    return user.role;
  };

  const displayRole = getDisplayRole();

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
      >
        {/* Avatar placeholder - will be replaced with Twitch avatar later */}
        <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-white font-semibold">
          {user.displayName.charAt(0).toUpperCase()}
        </div>
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{user.displayName}</span>
        {userBalance > 0 && (
          <span className="text-xs text-gray-500 dark:text-gray-400">({userBalance} coins)</span>
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
        <div className="absolute right-0 mt-2 w-56 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 py-2 z-50">
          {/* User info header */}
          <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center text-white font-semibold">
                {user.displayName.charAt(0).toUpperCase()}
              </div>
              <div>
                <div className="font-medium text-gray-900 dark:text-white">{user.displayName}</div>
                <div className="text-sm text-gray-500 dark:text-gray-400">{displayRole}</div>
              </div>
            </div>
          </div>

          {/* Menu items */}
          <div className="py-1">
            {(user.role === 'streamer' || user.role === 'admin') && (
              <button
                onClick={handleMyProfile}
                className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              >
                My Profile
              </button>
            )}
            <button
              onClick={handleSubmitMeme}
              className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            >
              Submit Meme
            </button>
            {(user.role === 'streamer' || user.role === 'admin') && (
              <button
                onClick={handleAdmin}
                className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              >
                Admin Panel
              </button>
            )}
          </div>

          {/* Divider */}
          <div className="border-t border-gray-200 dark:border-gray-700 my-1"></div>

          {/* Logout */}
          <button
            onClick={handleLogout}
            className="w-full text-left px-4 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
          >
            Logout
          </button>
        </div>
      )}
    </div>
  );
}

