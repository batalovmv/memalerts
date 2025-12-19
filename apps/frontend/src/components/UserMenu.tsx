import { useState, useRef, useEffect } from 'react';
import { useNavigate, useLocation, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAppSelector, useAppDispatch } from '../store/hooks';
import { logout } from '../store/slices/authSlice';
import toast from 'react-hot-toast';

export default function UserMenu() {
  const { t } = useTranslation();
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
      toast.success(t('userMenu.loggedOutSuccessfully'));
    } catch (error) {
      toast.error(t('userMenu.failedToLogout'));
    }
  };

  const handleMyProfile = () => {
    // Admin is an additional role, not exclusive - admin can also be a streamer
    // Check if user has a channel (regardless of role)
    if (user.channelId && user.channel?.slug) {
      navigate(`/channel/${user.channel.slug}`);
    } else {
      navigate('/dashboard');
    }
    setIsOpen(false);
  };

  const handleDashboard = () => {
    navigate('/dashboard');
    setIsOpen(false);
  };

  const handleSettings = () => {
    navigate('/settings?tab=settings');
    setIsOpen(false);
  };

  // Determine displayed role based on context
  // Show "streamer" only when viewing own profile, "viewer" when viewing someone else's profile
  const getDisplayRole = (): string => {
    // If on channel profile page
    if (location.pathname.startsWith('/channel/') && params.slug) {
      // Check if this is the user's own channel
      if (user.channel?.slug === params.slug) {
        return t('userMenu.streamer');
      } else {
        // Viewing someone else's channel
        return t('userMenu.viewer');
      }
    }
    // On other pages (dashboard, admin, etc.), show actual role
    if (user.role === 'admin') {
      return t('userMenu.admin');
    }
    if (user.role === 'streamer') {
      return t('userMenu.streamer');
    }
    return t('userMenu.viewer');
  };

  const displayRole = getDisplayRole();

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
      >
        {/* Avatar */}
        {user.profileImageUrl ? (
          <img 
            src={user.profileImageUrl} 
            alt={user.displayName}
            className="w-8 h-8 rounded-full object-cover"
          />
        ) : (
          <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-white font-semibold">
            {user.displayName.charAt(0).toUpperCase()}
          </div>
        )}
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{user.displayName}</span>
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
              {user.profileImageUrl ? (
                <img 
                  src={user.profileImageUrl} 
                  alt={user.displayName}
                  className="w-10 h-10 rounded-full object-cover"
                />
              ) : (
                <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center text-white font-semibold">
                  {user.displayName.charAt(0).toUpperCase()}
                </div>
              )}
              <div>
                <div className="font-medium text-gray-900 dark:text-white">{user.displayName}</div>
                <div className="text-sm text-gray-500 dark:text-gray-400">{displayRole}</div>
              </div>
            </div>
          </div>

          {/* Menu items */}
          <div className="py-1">
            {(user.role === 'streamer' || user.role === 'admin') && (
              <>
                <button
                  onClick={handleMyProfile}
                  className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                >
                  {t('userMenu.myProfile')}
                </button>
                <button
                  onClick={handleDashboard}
                  className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                >
                  {t('userMenu.dashboard')}
                </button>
                <button
                  onClick={handleSettings}
                  className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                >
                  {t('userMenu.settings')}
                </button>
              </>
            )}
          </div>

          {/* Divider */}
          <div className="border-t border-gray-200 dark:border-gray-700 my-1"></div>

          {/* Logout */}
          <button
            onClick={handleLogout}
            className="w-full text-left px-4 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
          >
            {t('userMenu.logout')}
          </button>
        </div>
      )}
    </div>
  );
}

