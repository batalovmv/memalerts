import { useEffect, useId, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate, useParams } from 'react-router-dom';

import { focusSafely, getFocusableElements } from '@/shared/lib/a11y/focus';
import { getEffectiveUserMode } from '@/shared/lib/uiMode';
import { setStoredUserMode } from '@/shared/lib/userMode';
import { getViewerHome, setViewerHome } from '@/shared/lib/viewerHome';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { logout } from '@/store/slices/authSlice';

export default function UserMenu() {
  const { t } = useTranslation();
  const { user } = useAppSelector((state) => state.auth);
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams<{ slug: string }>();
  const reactId = useId();
  const menuId = `user-menu-${reactId.replace(/:/g, '')}`;
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuPopupRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const openedByKeyboardRef = useRef(false);
  const openFocusIntentRef = useRef<'first' | 'last'>('first');

  const uiMode = getEffectiveUserMode(user);
  const canSwitchToStreamer = Boolean(
    user && uiMode === 'viewer' && (user.role === 'streamer' || user.role === 'admin') && !!user.channelId,
  );

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

  useEffect(() => {
    if (!isOpen) return;
    if (!openedByKeyboardRef.current) return;
    const popup = menuPopupRef.current;
    if (!popup) return;

    const raf = window.requestAnimationFrame(() => {
      const items = getFocusableElements(popup);
      if (items.length === 0) return;
      focusSafely(openFocusIntentRef.current === 'last' ? items[items.length - 1] : items[0]);
    });

    return () => window.cancelAnimationFrame(raf);
  }, [isOpen]);

  // Keep viewer "home" channel in sync when user is browsing channel pages in viewer mode.
  useEffect(() => {
    if (!user) return;
    if (uiMode !== 'viewer') return;
    if (!location.pathname.startsWith('/channel/')) return;
    if (!params.slug) return;
    setViewerHome(`/channel/${params.slug}`);
  }, [location.pathname, params.slug, uiMode, user]);

  if (!user) {
    return null;
  }

  const handleLogout = async () => {
    try {
      await dispatch(logout()).unwrap();
      navigate('/');
      toast.success(t('userMenu.loggedOutSuccessfully'));
    } catch {
      toast.error(t('userMenu.failedToLogout'));
    }
  };

  const handleDashboard = () => {
    setStoredUserMode('streamer');
    navigate('/dashboard');
    setIsOpen(false);
  };

  const handleSettings = () => {
    navigate('/settings?tab=settings');
    setIsOpen(false);
  };

  const handleAccounts = () => {
    navigate('/settings/accounts');
    setIsOpen(false);
  };

  const handleMySubmissions = () => {
    setStoredUserMode('viewer');
    navigate('/submit');
    setIsOpen(false);
  };

  const handlePool = () => {
    setStoredUserMode('viewer');
    navigate('/pool');
    setIsOpen(false);
  };

  const handlePublicProfile = () => {
    // In viewer mode, "Public profile" should mean the channel we came to (or are browsing now),
    // not necessarily the user's own channel.
    if (uiMode === 'viewer') {
      const home = getViewerHome();
      if (home) {
        navigate(home);
      } else if (location.pathname.startsWith('/channel/') && params.slug) {
        navigate(`/channel/${params.slug}`);
      } else if (user.channel?.slug) {
        navigate(`/channel/${user.channel.slug}`);
      } else {
        navigate('/search');
      }
      setIsOpen(false);
      return;
    }

    if (!user.channelId || !user.channel?.slug) return;
    setStoredUserMode('viewer');
    navigate(`/channel/${user.channel.slug}`);
    setIsOpen(false);
  };

  // Determine displayed role based on context
  // Show "streamer" only when viewing own profile, "viewer" when viewing someone else's profile
  const getDisplayRole = (): string => {
    if (uiMode === 'viewer') return t('userMenu.viewer');
    // If on channel profile page
    if (location.pathname.startsWith('/channel/') && params.slug) {
      // Check if this is the user's own channel
      if (user.channel?.slug === params.slug) {
        return t('userMenu.streamer');
      }
      // Viewing someone else's channel
      return t('userMenu.viewer');
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
        ref={triggerRef}
        onClick={() => {
          openedByKeyboardRef.current = false;
          setIsOpen(!isOpen);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            if (!isOpen) return;
            e.preventDefault();
            e.stopPropagation();
            setIsOpen(false);
            focusSafely(triggerRef.current);
            return;
          }
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openedByKeyboardRef.current = true;
            openFocusIntentRef.current = e.key === 'ArrowUp' ? 'last' : 'first';
            setIsOpen(true);
          }
        }}
        className="glass-btn bg-white/40 dark:bg-white/5 hover:bg-white/60 dark:hover:bg-white/10 ring-1 ring-black/5 dark:ring-white/10 flex items-center gap-2 px-3 py-2 rounded-xl transition-colors"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-controls={menuId}
      >
        {/* Avatar */}
        {user.profileImageUrl ? (
          <img src={user.profileImageUrl} alt={user.displayName} className="w-8 h-8 rounded-full object-cover" />
        ) : (
          <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-white font-semibold">
            {user.displayName.charAt(0).toUpperCase()}
          </div>
        )}
        <span className="text-sm font-medium text-gray-900 dark:text-white">{user.displayName}</span>
        <svg
          className={`w-4 h-4 text-gray-600 dark:text-gray-300 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <>
          {/* Backdrop: prevents “invisible layer” click issues and makes outside click behavior consistent. */}
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} aria-hidden="true" />

          <div
            id={menuId}
            ref={menuPopupRef}
            role="menu"
            aria-label={t('userMenu.menu', { defaultValue: 'User menu' })}
            className="absolute right-0 mt-2 w-56 glass rounded-xl shadow-xl ring-1 ring-black/5 dark:ring-white/10 py-2 z-50"
            onKeyDownCapture={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                setIsOpen(false);
                focusSafely(triggerRef.current);
                return;
              }

              if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
              const popup = menuPopupRef.current;
              if (!popup) return;
              const items = getFocusableElements(popup);
              if (items.length === 0) return;

              const active = document.activeElement;
              const currentIndex = active instanceof HTMLElement ? items.indexOf(active) : -1;

              e.preventDefault();
              if (e.key === 'Home') {
                focusSafely(items[0]);
                return;
              }
              if (e.key === 'End') {
                focusSafely(items[items.length - 1]);
                return;
              }

              const nextIndex =
                e.key === 'ArrowDown'
                  ? (currentIndex + 1 + items.length) % items.length
                  : (currentIndex - 1 + items.length) % items.length;
              focusSafely(items[nextIndex] ?? items[0]);
            }}
          >
            {/* User info header */}
            <div className="px-4 py-3 border-b border-black/5 dark:border-white/10">
              <div className="flex items-center gap-3">
                {user.profileImageUrl ? (
                  <img src={user.profileImageUrl} alt={user.displayName} className="w-10 h-10 rounded-full object-cover" />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center text-white font-semibold">
                    {user.displayName.charAt(0).toUpperCase()}
                  </div>
                )}
                <div>
                  <div className="font-medium text-gray-900 dark:text-white">{user.displayName}</div>
                  <div className="text-sm text-gray-600 dark:text-gray-300">{displayRole}</div>
                </div>
              </div>
            </div>

            {/* Menu items */}
            <div className="py-1">
              {uiMode === 'viewer' ? (
                <>
                  <button
                    onClick={handleMySubmissions}
                    className="w-full text-left px-4 py-2 text-sm text-gray-800 dark:text-gray-200 hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
                    type="button"
                    role="menuitem"
                  >
                    {t('userMenu.mySubmissions', { defaultValue: 'My submissions' })}
                  </button>

                  <button
                    onClick={handleAccounts}
                    className="w-full text-left px-4 py-2 text-sm text-gray-800 dark:text-gray-200 hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
                    type="button"
                    role="menuitem"
                  >
                    {t('userMenu.linkAccounts', { defaultValue: 'Link accounts' })}
                  </button>

                  {canSwitchToStreamer ? (
                    <button
                      onClick={handleDashboard}
                      className="w-full text-left px-4 py-2 text-sm text-gray-800 dark:text-gray-200 hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
                      type="button"
                      role="menuitem"
                    >
                      {t('userMenu.switchToStreamer', { defaultValue: 'Switch to streamer mode' })}
                    </button>
                  ) : null}
                </>
              ) : (
                <>
                  {user.channelId && user.channel?.slug ? (
                    <button
                      onClick={handlePublicProfile}
                      className="w-full text-left px-4 py-2 text-sm text-gray-800 dark:text-gray-200 hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
                      type="button"
                      role="menuitem"
                    >
                      {t('userMenu.publicProfile', { defaultValue: 'Public profile' })}
                    </button>
                  ) : null}

                  <button
                    onClick={handleSettings}
                    className="w-full text-left px-4 py-2 text-sm text-gray-800 dark:text-gray-200 hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
                    type="button"
                    role="menuitem"
                  >
                    {t('userMenu.settings')}
                  </button>

                  <button
                    onClick={handlePool}
                    className="w-full text-left px-4 py-2 text-sm text-gray-800 dark:text-gray-200 hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
                    type="button"
                    role="menuitem"
                  >
                    {t('userMenu.pool', { defaultValue: 'Meme pool' })}
                  </button>

                  {user.role === 'streamer' || user.role === 'admin' ? (
                    <>
                      <button
                        onClick={handleDashboard}
                        className="w-full text-left px-4 py-2 text-sm text-gray-800 dark:text-gray-200 hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
                        type="button"
                        role="menuitem"
                      >
                        {t('userMenu.dashboard')}
                      </button>
                    </>
                  ) : null}
                </>
              )}
            </div>

            {/* Divider */}
            <div className="border-t border-black/5 dark:border-white/10 my-1" />

            {/* Logout */}
            <button
              onClick={handleLogout}
              className="w-full text-left px-4 py-2 text-sm text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 transition-colors"
              type="button"
              role="menuitem"
            >
              {t('userMenu.logout')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}


