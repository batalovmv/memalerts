import { Suspense, lazy, useEffect, useId, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';

import { useHeaderChannelData, useHeaderSocket, useHeaderSubmissions, useHeaderWallet } from './hooks';
import { BalanceDisplay, RequestsBell, SubmitButton } from './ui';

import UserMenu from '@/components/UserMenu';
import { login } from '@/lib/auth';
import { getEffectiveUserMode } from '@/shared/lib/uiMode';
import { useAppSelector } from '@/store/hooks';

const SubmitModal = lazy(() => import('@/components/SubmitModal'));
const AuthRequiredModal = lazy(() => import('@/components/AuthRequiredModal'));

export interface HeaderProps {
  channelSlug?: string;
  channelId?: string;
  primaryColor?: string | null;
  coinIconUrl?: string | null;
  rewardTitle?: string | null;
}

export default function Header({ channelSlug, channelId, primaryColor, coinIconUrl, rewardTitle }: HeaderProps) {
  const { t } = useTranslation();
  const { user } = useAppSelector((state) => state.auth);
  const uiMode = getEffectiveUserMode(user);
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams<{ slug: string }>();
  const reactId = useId();
  const requestsMenuId = `header-requests-${reactId.replace(/:/g, '')}`;

  const currentChannelSlug = channelSlug || params.slug;
  const isOwnProfile = Boolean(user && channelId && user.channelId === channelId);

  const {
    wallet,
    isLoadingWallet,
    coinUpdateDelta,
    clearCoinUpdateDelta,
    handleWalletUpdate,
  } = useHeaderWallet(currentChannelSlug, channelId);

  const {
    pendingCount: pendingSubmissionsCount,
    submissionsLoading,
    submissionsCount,
    needsChangesCount: myNeedsChangesCount,
    mySubmissionsLoading,
  } = useHeaderSubmissions();

  const { coinIconUrl: resolvedCoinIconUrl } = useHeaderChannelData({
    channelSlug: currentChannelSlug,
    coinIconUrl,
    rewardTitle,
  });

  useHeaderSocket({ channelSlug: currentChannelSlug, channelId, onWalletUpdate: handleWalletUpdate });

  const [isSubmitModalOpen, setIsSubmitModalOpen] = useState(false);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [isRequestsMenuOpen, setIsRequestsMenuOpen] = useState(false);
  const requestsMenuRef = useRef<HTMLDivElement>(null);

  const showSubmitButton =
    user &&
    (location.pathname === '/dashboard' || location.pathname.startsWith('/settings') || isOwnProfile);

  const showPendingIndicator = Boolean(user && uiMode === 'streamer' && (user.role === 'streamer' || user.role === 'admin'));
  const hasPendingSubmissions = pendingSubmissionsCount > 0;
  const hasNeedsChanges = myNeedsChangesCount > 0;
  const showRequestsIndicator = Boolean(user) && (showPendingIndicator || hasNeedsChanges || mySubmissionsLoading);
  const requestsTotalCount = (showPendingIndicator ? pendingSubmissionsCount : 0) + myNeedsChangesCount;
  const isLoadingSubmissions = submissionsLoading && submissionsCount === 0;
  const balance = wallet?.balance || 0;
  const isInfiniteBalance =
    !!user &&
    uiMode === 'streamer' &&
    (user.role === 'streamer' || user.role === 'admin') &&
    (location.pathname === '/dashboard' || location.pathname.startsWith('/settings') || isOwnProfile);

  const navStyle: CSSProperties = {
    backgroundColor: primaryColor && !document.documentElement.classList.contains('dark') ? primaryColor : undefined,
  };

  const logoStyle: CSSProperties = {
    color: primaryColor && !document.documentElement.classList.contains('dark') ? '#ffffff' : undefined,
  };

  const requireAuth = () => setAuthModalOpen(true);

  const handlePendingSubmissionsClick = () => {
    const params = new URLSearchParams(location.search);
    const currentPanel = (params.get('panel') || params.get('tab') || '').toLowerCase();
    const isOnDashboard = location.pathname.startsWith('/dashboard');
    const isOpen = isOnDashboard && currentPanel === 'submissions';

    params.delete('tab');
    params.delete('panel');
    if (!isOpen) {
      params.set('panel', 'submissions');
    }
    const search = params.toString();
    navigate(search ? `/dashboard?${search}` : '/dashboard');
  };

  const requestsTitle = useMemo(() => {
    if (!user) return '';
    if (showPendingIndicator && hasPendingSubmissions && hasNeedsChanges) {
      return t('header.submissionsSummary', {
        defaultValue: 'Pending: {{pending}}, needs changes: {{needsChanges}}',
        pending: pendingSubmissionsCount,
        needsChanges: myNeedsChangesCount,
      });
    }
    if (showPendingIndicator && hasPendingSubmissions) {
      return pendingSubmissionsCount === 1
        ? t('header.pendingSubmissions', { count: 1 })
        : t('header.pendingSubmissionsPlural', { count: pendingSubmissionsCount });
    }
    if (hasNeedsChanges) {
      return t('header.needsChangesSubmissions', {
        defaultValue: 'Needs changes: {{count}}',
        count: myNeedsChangesCount,
      });
    }
    if (mySubmissionsLoading) {
      return t('header.loadingSubmissions', { defaultValue: 'Loading submissions...' });
    }
    return t('header.noSubmissions', { defaultValue: 'No submissions' });
  }, [
    user,
    showPendingIndicator,
    hasPendingSubmissions,
    hasNeedsChanges,
    mySubmissionsLoading,
    t,
    pendingSubmissionsCount,
    myNeedsChangesCount,
  ]);

  const pendingApprovalsLabel = t('header.pendingApprovals', { defaultValue: 'Pending approvals' });
  const needsChangesLabel = t('header.needsChanges', { defaultValue: 'Needs changes' });

  const requestsTooltip =
    showPendingIndicator && hasPendingSubmissions && hasNeedsChanges
      ? t('help.header.requests', {
          defaultValue: 'Your notifications: pending approvals and submissions that need changes.',
        })
      : showPendingIndicator && hasPendingSubmissions
        ? pendingApprovalsLabel
        : needsChangesLabel;

  const showRequestsMenu = showPendingIndicator && hasPendingSubmissions && hasNeedsChanges;

  // Close requests popover on outside click
  useEffect(() => {
    if (!isRequestsMenuOpen) return;
    const onDown = (event: MouseEvent) => {
      const root = requestsMenuRef.current;
      if (!root) return;
      if (!root.contains(event.target as Node)) setIsRequestsMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [isRequestsMenuOpen]);

  return (
    <>
      <nav className="bg-white dark:bg-gray-800 shadow-sm channel-theme-nav" style={navStyle}>
        <div className="page-container">
          <div className="flex justify-between h-16 items-center gap-2 min-w-0">
            <h1
              className="text-lg sm:text-xl font-bold dark:text-white cursor-pointer channel-theme-logo truncate min-w-0"
              style={logoStyle}
            >
              <Link to="/" className="text-inherit">
                Mem Alerts
              </Link>
            </h1>

            {user ? (
              <div className="flex items-center gap-1 sm:gap-3 flex-shrink-0">
                {showRequestsIndicator && (
                  <div className="relative" ref={requestsMenuRef}>
                    <RequestsBell
                      count={requestsTotalCount}
                      isLoading={isLoadingSubmissions && showPendingIndicator}
                      title={requestsTitle}
                      tooltip={requestsTooltip}
                      onClick={() => {
                        if (!showPendingIndicator || !hasPendingSubmissions) {
                          navigate('/submit?tab=needs_changes');
                          return;
                        }
                        if (!hasNeedsChanges) {
                          handlePendingSubmissionsClick();
                          return;
                        }
                        setIsRequestsMenuOpen((v) => !v);
                      }}
                      showMenu={showRequestsMenu}
                      menuId={showRequestsMenu ? requestsMenuId : undefined}
                      isMenuOpen={showRequestsMenu ? isRequestsMenuOpen : undefined}
                    />

                    {showRequestsMenu && isRequestsMenuOpen && (
                      <div
                        id={requestsMenuId}
                        role="menu"
                        aria-label={t('header.submissionsMenu', { defaultValue: 'Submissions menu' })}
                        className="absolute right-0 mt-2 w-64 glass rounded-xl shadow-xl ring-1 ring-black/5 dark:ring-white/10 py-2 z-50"
                      >
                        <button
                          type="button"
                          role="menuitem"
                          className="w-full text-left px-4 py-2 text-sm text-gray-800 dark:text-gray-200 hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
                          onClick={() => {
                            setIsRequestsMenuOpen(false);
                            handlePendingSubmissionsClick();
                          }}
                        >
                          {pendingApprovalsLabel}{' '}
                          <span className="text-xs text-gray-500 dark:text-gray-400">({pendingSubmissionsCount})</span>
                        </button>

                        <button
                          type="button"
                          role="menuitem"
                          className="w-full text-left px-4 py-2 text-sm text-gray-800 dark:text-gray-200 hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
                          onClick={() => {
                            setIsRequestsMenuOpen(false);
                            navigate('/submit?tab=needs_changes');
                          }}
                        >
                          {needsChangesLabel}{' '}
                          <span className="text-xs text-gray-500 dark:text-gray-400">({myNeedsChangesCount})</span>
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {showSubmitButton && (
                  <SubmitButton
                    onClick={() => setIsSubmitModalOpen(true)}
                    label={t('header.submitMeme')}
                    tooltip={t('help.header.submit', { defaultValue: 'Submit a meme to your channel (upload or import).' })}
                    ariaLabel={t('header.submitMeme')}
                  />
                )}

                <BalanceDisplay
                  balance={balance}
                  isInfinite={isInfiniteBalance}
                  isLoading={isLoadingWallet}
                  coinIconUrl={resolvedCoinIconUrl ?? undefined}
                  coinUpdateDelta={coinUpdateDelta}
                  onClick={clearCoinUpdateDelta}
                  tooltip={t('help.header.balance', { defaultValue: 'Your coin balance. You can earn coins via the channel reward.' })}
                  ariaLabel={t('header.balance', { defaultValue: 'Balance' })}
                  coinAlt={t('header.coin', { defaultValue: 'Coin' })}
                />

                <UserMenu />
              </div>
            ) : (
              <div className="flex items-center gap-1 sm:gap-3 flex-shrink-0">
                <button
                  type="button"
                  onClick={requireAuth}
                  className="relative p-2 rounded-xl transition-colors hover:bg-gray-100 dark:hover:bg-gray-700 opacity-80"
                  aria-label={t('auth.loginToInteract', 'Log in to submit memes and use favorites')}
                >
                  <svg className="w-6 h-6 text-gray-400 dark:text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
                    />
                  </svg>
                </button>

                <SubmitButton
                  onClick={requireAuth}
                  label={t('header.submitMeme', { defaultValue: 'Submit Meme' })}
                  tooltip={t('help.header.loginRequired', { defaultValue: 'Log in to submit memes and use favorites.' })}
                  ariaLabel={t('header.submitMeme', { defaultValue: 'Submit Meme' })}
                />

                <BalanceDisplay
                  balance={0}
                  coinIconUrl={undefined}
                  onClick={requireAuth}
                  tooltip={t('help.header.loginToUseWallet', { defaultValue: 'Log in to earn coins and activate memes.' })}
                  ariaLabel={t('header.balance', { defaultValue: 'Balance' })}
                />

                <button
                  type="button"
                  onClick={requireAuth}
                  className="flex items-center gap-2 px-2 sm:px-3 py-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                >
                  <div className="w-8 h-8 rounded-lg bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-gray-600 dark:text-gray-200 font-bold">
                    ?
                  </div>
                  <span className="text-sm hidden sm:inline text-gray-800 dark:text-gray-100">
                    {t('auth.guest', { defaultValue: 'Guest' })}
                  </span>
                </button>
              </div>
            )}
          </div>
        </div>
      </nav>

      <Suspense fallback={null}>
        <SubmitModal
          isOpen={isSubmitModalOpen}
          onClose={() => setIsSubmitModalOpen(false)}
          channelSlug={currentChannelSlug}
          channelId={isOwnProfile ? channelId : undefined}
        />

        <AuthRequiredModal
          isOpen={authModalOpen}
          onClose={() => setAuthModalOpen(false)}
          onCtaClick={() => {
            setAuthModalOpen(false);
            login(location.pathname + location.search);
          }}
        />
      </Suspense>
    </>
  );
}
