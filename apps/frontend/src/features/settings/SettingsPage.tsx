import { Suspense, lazy, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';

import Header from '@/components/Header';
import { ChannelSettings } from '@/features/settings/tabs/ChannelSettings';
import { focusSafely, getFocusableElements } from '@/shared/lib/a11y/focus';
import { IconButton, PageShell, Spinner } from '@/shared/ui';
import { useAppSelector } from '@/store/hooks';

const RewardsSettingsTab = lazy(() =>
  import('@/features/settings/tabs/RewardsSettings').then((m) => ({ default: m.RewardsSettings }))
);
const ObsLinksSettingsTab = lazy(() =>
  import('@/features/settings/tabs/ObsLinksSettings').then((m) => ({ default: m.ObsLinksSettings }))
);
const BotSettingsTab = lazy(() => import('@/features/settings/tabs/BotSettings').then((m) => ({ default: m.BotSettings })));
const AccountsSettingsTab = lazy(() =>
  import('@/features/settings/tabs/AccountsSettings').then((m) => ({ default: m.AccountsSettings }))
);
const WalletManagementTab = lazy(() =>
  import('@/features/settings/tabs/WalletManagement').then((m) => ({ default: m.WalletManagement }))
);
const OwnerEntitlementsTab = lazy(() =>
  import('@/features/settings/tabs/OwnerEntitlements').then((m) => ({ default: m.OwnerEntitlements }))
);
const PromotionManagementTab = lazy(() =>
  import('@/features/settings/tabs/PromotionManagement').then((m) => ({ default: m.PromotionManagement }))
);
const ChannelStatisticsTab = lazy(() =>
  import('@/features/settings/tabs/ChannelStatistics').then((m) => ({ default: m.ChannelStatistics }))
);
const BetaAccessManagementTab = lazy(() =>
  import('@/features/settings/tabs/BetaAccessManagement').then((m) => ({ default: m.BetaAccessManagement }))
);
const BetaAccessSelfTab = lazy(() => import('@/features/settings/tabs/BetaAccessSelf').then((m) => ({ default: m.BetaAccessSelf })));

type TabType =
  | 'settings'
  | 'rewards'
  | 'obs'
  | 'bot'
  | 'accounts'
  | 'wallets'
  | 'promotions'
  | 'statistics'
  | 'beta'
  | 'entitlements';

export default function SettingsPage() {
  const { t } = useTranslation();
  const { user, loading: authLoading } = useAppSelector((state) => state.auth);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const moreMenuReactId = useId();
  const moreMenuId = `settings-more-menu-${moreMenuReactId.replace(/:/g, '')}`;
  const tabsReactId = useId();
  const tabsIdBase = `settings-tabs-${tabsReactId.replace(/:/g, '')}`;
  const [activeTab, setActiveTab] = useState<TabType>('settings');
  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false);
  const moreMenuButtonRef = useRef<HTMLButtonElement>(null);
  const moreMenuPopupRef = useRef<HTMLDivElement>(null);
  const moreMenuOpenedByKeyboardRef = useRef(false);
  const moreMenuOpenFocusIntentRef = useRef<'first' | 'last'>('first');
  const isStreamerAdmin = user?.role === 'streamer' || user?.role === 'admin';

  const iconClass = 'w-5 h-5';
  const MenuIcon = (
    <svg className={iconClass} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="5" cy="12" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="19" cy="12" r="1.8" />
    </svg>
  );

  const menuItemIconClass = 'w-4 h-4';
  const StatsIcon = (
    <svg className={menuItemIconClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 19V5m0 14h16" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M7 15l3-3 3 3 6-6" />
    </svg>
  );
  const PromoIcon = (
    <svg className={menuItemIconClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M7 7h10l1 5-1 5H7l1-5-1-5Z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 7l1 10" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M14 7l1 10" />
    </svg>
  );
  const WalletIcon = (
    <svg className={menuItemIconClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 7h18v12H3z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 7l2-3h14l2 3" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M16 13h5" />
    </svg>
  );
  const TicketIcon = (
    <svg className={menuItemIconClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4V8Z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12" />
    </svg>
  );
  const BetaIcon = (
    <svg className={menuItemIconClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 2l3 7 7 3-7 3-3 7-3-7-7-3 7-3 3-7Z" />
    </svg>
  );
  const AccountsIcon = (
    <svg className={menuItemIconClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M20 21a8 8 0 0 0-16 0" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 13a4 4 0 1 0-4-4 4 4 0 0 0 4 4Z" />
    </svg>
  );

  const primaryTabs = useMemo(() => {
    if (!isStreamerAdmin) return [] as TabType[];
    return ['settings', 'rewards', 'obs', 'bot'] as TabType[];
  }, [isStreamerAdmin]);

  const getTabButtonId = (tab: TabType) => `${tabsIdBase}-tab-${tab}`;
  const getTabPanelId = (tab: TabType) => `${tabsIdBase}-panel-${tab}`;

  const focusTabButton = (tab: TabType) => {
    const el = document.getElementById(getTabButtonId(tab));
    if (el instanceof HTMLElement) focusSafely(el);
  };

  const handlePrimaryTabKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, tab: TabType) => {
    if (primaryTabs.length === 0) return;
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    e.stopPropagation();

    const idx = primaryTabs.indexOf(tab);
    if (idx === -1) return;

    let next: TabType = tab;
    if (e.key === 'Home') next = primaryTabs[0]!;
    if (e.key === 'End') next = primaryTabs[primaryTabs.length - 1]!;
    if (e.key === 'ArrowRight') next = primaryTabs[(idx + 1) % primaryTabs.length]!;
    if (e.key === 'ArrowLeft') next = primaryTabs[(idx - 1 + primaryTabs.length) % primaryTabs.length]!;

    setActiveTab(next);
    // Ensure focus follows the selection (roving tabindex).
    window.requestAnimationFrame(() => focusTabButton(next));
  };

  // Handle tab parameter from URL
  useEffect(() => {
    // Support deep link: /settings/accounts
    const maybeSubPath = location.pathname.replace(/^\/settings\/?/, '');
    const pathTab = (maybeSubPath.split('/')[0] || '').trim();
    if (pathTab === 'accounts') {
      setActiveTab('accounts');
      return;
    }
    if (pathTab === 'bot') {
      setActiveTab('bot');
      return;
    }

    const tabParam = searchParams.get('tab');
    if (tabParam === 'submissions') {
      // Pending submissions live on the dashboard now.
      navigate('/dashboard?tab=submissions', { replace: true });
      return;
    }
    if (tabParam === 'memes') {
      // All memes now live on the dashboard for a more cohesive UX.
      navigate('/dashboard?panel=memes', { replace: true });
      return;
    }
    if (
      tabParam &&
      ['settings', 'rewards', 'obs', 'bot', 'accounts', 'wallets', 'entitlements', 'promotions', 'statistics', 'beta'].includes(tabParam)
    ) {
      setActiveTab(tabParam as TabType);
    }
  }, [searchParams, navigate, location.pathname]);

  // Viewers should land on beta access tab in settings.
  useEffect(() => {
    if (user && !isStreamerAdmin && activeTab !== 'beta' && activeTab !== 'accounts') {
      setActiveTab('beta');
    }
  }, [user, isStreamerAdmin, activeTab]);

  useEffect(() => {
    if (!isMoreMenuOpen) return;
    if (!moreMenuOpenedByKeyboardRef.current) return;
    const popup = moreMenuPopupRef.current;
    if (!popup) return;

    const raf = window.requestAnimationFrame(() => {
      const items = getFocusableElements(popup);
      if (items.length === 0) return;
      focusSafely(moreMenuOpenFocusIntentRef.current === 'last' ? items[items.length - 1] : items[0]);
    });
    return () => window.cancelAnimationFrame(raf);
  }, [isMoreMenuOpen]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      navigate('/', { replace: true });
      return;
    }
    // Allow viewers to access /settings for beta + accounts only.
    if (user.role !== 'streamer' && user.role !== 'admin') {
      const allowedViewerTabs: TabType[] = ['beta', 'accounts'];
      if (!allowedViewerTabs.includes(activeTab)) {
        navigate('/dashboard', { replace: true });
      }
    }
  }, [user, authLoading, navigate, activeTab]);

  if (authLoading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center gap-3 text-gray-600 dark:text-gray-300">
        <Spinner className="h-5 w-5" />
        <span className="text-base">{t('common.loading', { defaultValue: 'Loading…' })}</span>
      </div>
    );
  }

  return (
    <PageShell header={<Header />}>
      <div className="section-gap">
        <div className="surface">
          <div className="flex items-center border-b border-black/5 dark:border-white/10 px-3 sm:px-6 py-2 sm:py-3 gap-2">
            {/* Tabs scroller (mobile) */}
            <div className="flex-1 overflow-x-auto whitespace-nowrap [-webkit-overflow-scrolling:touch] no-scrollbar">
              <div
                className="flex gap-2 sm:gap-3 items-center"
                role="tablist"
                aria-label={t('settings.tabs', { defaultValue: 'Settings tabs' })}
              >
                {isStreamerAdmin && (
                  <button
                    onClick={() => setActiveTab('settings')}
                    onKeyDown={(e) => handlePrimaryTabKeyDown(e, 'settings')}
                    className={`px-4 py-2.5 rounded-lg transition-all text-sm font-medium whitespace-nowrap ${
                      activeTab === 'settings'
                        ? 'bg-primary text-white shadow-sm'
                        : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700/50'
                    }`}
                    type="button"
                    id={getTabButtonId('settings')}
                    role="tab"
                    aria-selected={activeTab === 'settings'}
                    aria-controls={getTabPanelId('settings')}
                    tabIndex={activeTab === 'settings' ? 0 : -1}
                  >
                    {t('admin.channelDesign', { defaultValue: 'Оформление' })}
                  </button>
                )}
                {isStreamerAdmin && (
                  <button
                    onClick={() => setActiveTab('rewards')}
                    onKeyDown={(e) => handlePrimaryTabKeyDown(e, 'rewards')}
                    className={`px-4 py-2.5 rounded-lg transition-all text-sm font-medium whitespace-nowrap ${
                      activeTab === 'rewards'
                        ? 'bg-primary text-white shadow-sm'
                        : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700/50'
                    }`}
                    type="button"
                    id={getTabButtonId('rewards')}
                    role="tab"
                    aria-selected={activeTab === 'rewards'}
                    aria-controls={getTabPanelId('rewards')}
                    tabIndex={activeTab === 'rewards' ? 0 : -1}
                  >
                    {t('admin.rewards', { defaultValue: 'Награды' })}
                  </button>
                )}
                {isStreamerAdmin && (
                  <button
                    onClick={() => setActiveTab('obs')}
                    onKeyDown={(e) => handlePrimaryTabKeyDown(e, 'obs')}
                    className={`px-4 py-2.5 rounded-lg transition-all text-sm font-medium whitespace-nowrap ${
                      activeTab === 'obs'
                        ? 'bg-primary text-white shadow-sm'
                        : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700/50'
                    }`}
                    type="button"
                    id={getTabButtonId('obs')}
                    role="tab"
                    aria-selected={activeTab === 'obs'}
                    aria-controls={getTabPanelId('obs')}
                    tabIndex={activeTab === 'obs' ? 0 : -1}
                  >
                    {t('admin.obsLinks', { defaultValue: 'OBS' })}
                  </button>
                )}
                {isStreamerAdmin && (
                  <button
                    onClick={() => setActiveTab('bot')}
                    onKeyDown={(e) => handlePrimaryTabKeyDown(e, 'bot')}
                    className={`px-4 py-2.5 rounded-lg transition-all text-sm font-medium whitespace-nowrap ${
                      activeTab === 'bot'
                        ? 'bg-primary text-white shadow-sm'
                        : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700/50'
                    }`}
                    type="button"
                    id={getTabButtonId('bot')}
                    role="tab"
                    aria-selected={activeTab === 'bot'}
                    aria-controls={getTabPanelId('bot')}
                    tabIndex={activeTab === 'bot' ? 0 : -1}
                  >
                    {t('admin.bot', { defaultValue: 'Bot' })}
                  </button>
                )}
              </div>
            </div>

            {/* More menu (fixed on the right) */}
            <div className="relative flex-shrink-0 ml-2 border-l border-black/5 dark:border-white/10 pl-3">
              <IconButton
                ref={moreMenuButtonRef}
                onClick={() => {
                  moreMenuOpenedByKeyboardRef.current = false;
                  setIsMoreMenuOpen((v) => !v);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    if (!isMoreMenuOpen) return;
                    e.preventDefault();
                    e.stopPropagation();
                    setIsMoreMenuOpen(false);
                    focusSafely(moreMenuButtonRef.current);
                    return;
                  }
                  if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    moreMenuOpenedByKeyboardRef.current = true;
                    moreMenuOpenFocusIntentRef.current = e.key === 'ArrowUp' ? 'last' : 'first';
                    setIsMoreMenuOpen(true);
                  }
                }}
                className={`${
                  ['wallets', 'promotions', 'statistics', 'beta', 'accounts', 'entitlements'].includes(activeTab)
                    ? ''
                    : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                }`}
                variant={['wallets', 'promotions', 'statistics', 'beta', 'accounts', 'entitlements'].includes(activeTab) ? 'primary' : 'ghost'}
                type="button"
                aria-label={t('admin.more', { defaultValue: 'More' })}
                aria-haspopup="menu"
                aria-expanded={isMoreMenuOpen}
                aria-controls={moreMenuId}
                icon={MenuIcon}
              />

              {/* Dropdown меню */}
              {isMoreMenuOpen && (
                <>
                  {/* Backdrop: prevents "invisible layer" click issues and makes outside click behavior consistent. */}
                  <div className="fixed inset-0 z-40" onClick={() => setIsMoreMenuOpen(false)} aria-hidden="true" />
                  <div
                    id={moreMenuId}
                    ref={moreMenuPopupRef}
                    role="menu"
                    aria-label={t('admin.more', { defaultValue: 'More' })}
                    className="absolute right-0 top-full mt-2 w-60 glass rounded-xl shadow-xl ring-1 ring-black/5 dark:ring-white/10 py-2 z-50"
                    onKeyDownCapture={(e) => {
                      if (e.key === 'Escape') {
                        e.preventDefault();
                        e.stopPropagation();
                        setIsMoreMenuOpen(false);
                        focusSafely(moreMenuButtonRef.current);
                        return;
                      }

                      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
                      const popup = moreMenuPopupRef.current;
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
                    <div className="px-1 py-1">
                      <button
                        onClick={() => {
                          setActiveTab('statistics');
                          setIsMoreMenuOpen(false);
                        }}
                        className={`w-full text-left px-3 py-2 text-sm font-medium transition-colors rounded-md mx-1 flex items-center gap-2 ${
                          activeTab === 'statistics'
                            ? 'bg-primary/10 text-primary'
                            : 'text-gray-700 dark:text-gray-300 hover:bg-black/5 dark:hover:bg-white/10'
                        }`}
                        type="button"
                        role="menuitem"
                      >
                        <span className={activeTab === 'statistics' ? 'text-primary' : 'text-gray-500 dark:text-gray-400'}>{StatsIcon}</span>
                        <span className="min-w-0 truncate">{t('admin.statistics')}</span>
                      </button>
                      <button
                        onClick={() => {
                          setActiveTab('promotions');
                          setIsMoreMenuOpen(false);
                        }}
                        className={`w-full text-left px-3 py-2 text-sm font-medium transition-colors rounded-md mx-1 flex items-center gap-2 ${
                          activeTab === 'promotions'
                            ? 'bg-primary/10 text-primary'
                            : 'text-gray-700 dark:text-gray-300 hover:bg-black/5 dark:hover:bg-white/10'
                        }`}
                        type="button"
                        role="menuitem"
                      >
                        <span className={activeTab === 'promotions' ? 'text-primary' : 'text-gray-500 dark:text-gray-400'}>{PromoIcon}</span>
                        <span className="min-w-0 truncate">{t('admin.promotions')}</span>
                      </button>
                    </div>
                    <div className="border-t border-black/5 dark:border-white/10 my-1" />

                    <div className="px-1 py-1">
                      {(user?.role === 'admin' || isStreamerAdmin) && (
                        <button
                          onClick={() => {
                            setActiveTab('wallets');
                            setIsMoreMenuOpen(false);
                          }}
                          className={`w-full text-left px-3 py-2 text-sm font-medium transition-colors rounded-md mx-1 flex items-center gap-2 ${
                            activeTab === 'wallets'
                              ? 'bg-primary/10 text-primary'
                              : 'text-gray-700 dark:text-gray-300 hover:bg-black/5 dark:hover:bg-white/10'
                          }`}
                          type="button"
                          role="menuitem"
                        >
                          <span className={activeTab === 'wallets' ? 'text-primary' : 'text-gray-500 dark:text-gray-400'}>{WalletIcon}</span>
                          <span className="min-w-0 truncate">{t('admin.walletManagement')}</span>
                        </button>
                      )}

                      {user?.role === 'admin' && (
                        <button
                          onClick={() => {
                            setActiveTab('entitlements');
                            setIsMoreMenuOpen(false);
                          }}
                          className={`w-full text-left px-3 py-2 text-sm font-medium transition-colors rounded-md mx-1 flex items-center gap-2 ${
                            activeTab === 'entitlements'
                              ? 'bg-primary/10 text-primary'
                              : 'text-gray-700 dark:text-gray-300 hover:bg-black/5 dark:hover:bg-white/10'
                          }`}
                          type="button"
                          role="menuitem"
                        >
                          <span className={activeTab === 'entitlements' ? 'text-primary' : 'text-gray-500 dark:text-gray-400'}>{TicketIcon}</span>
                          <span className="min-w-0 truncate">{t('admin.entitlements', { defaultValue: 'Entitlements' })}</span>
                        </button>
                      )}

                      <button
                        onClick={() => {
                          setActiveTab('beta');
                          setIsMoreMenuOpen(false);
                        }}
                        className={`w-full text-left px-3 py-2 text-sm font-medium transition-colors rounded-md mx-1 flex items-center gap-2 ${
                          activeTab === 'beta'
                            ? 'bg-primary/10 text-primary'
                            : 'text-gray-700 dark:text-gray-300 hover:bg-black/5 dark:hover:bg-white/10'
                        }`}
                        type="button"
                        role="menuitem"
                      >
                        <span className={activeTab === 'beta' ? 'text-primary' : 'text-gray-500 dark:text-gray-400'}>{BetaIcon}</span>
                        <span className="min-w-0 truncate">{t('admin.betaAccess')}</span>
                      </button>

                      <button
                        onClick={() => {
                          setActiveTab('accounts');
                          setIsMoreMenuOpen(false);
                        }}
                        className={`w-full text-left px-3 py-2 text-sm font-medium transition-colors rounded-md mx-1 flex items-center gap-2 ${
                          activeTab === 'accounts'
                            ? 'bg-primary/10 text-primary'
                            : 'text-gray-700 dark:text-gray-300 hover:bg-black/5 dark:hover:bg-white/10'
                        }`}
                        type="button"
                        role="menuitem"
                      >
                        <span className={activeTab === 'accounts' ? 'text-primary' : 'text-gray-500 dark:text-gray-400'}>{AccountsIcon}</span>
                        <span className="min-w-0 truncate">{t('settings.accounts', { defaultValue: 'Accounts' })}</span>
                      </button>
                    </div>

                    {/* walletManagement entry is rendered above once (admin OR streamer admin) */}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        <Suspense
          fallback={
            <div className="py-10 flex items-center justify-center gap-3 text-gray-600 dark:text-gray-300">
              <Spinner className="h-5 w-5" />
              <span>{t('common.loading', { defaultValue: 'Loading…' })}</span>
            </div>
          }
        >
          <div className="p-4 sm:p-6 overflow-hidden">
            <div
              role="tabpanel"
              id={getTabPanelId('settings')}
              aria-labelledby={getTabButtonId('settings')}
              hidden={activeTab !== 'settings'}
            >
              {activeTab === 'settings' && isStreamerAdmin && <ChannelSettings />}
            </div>

            <div
              role="tabpanel"
              id={getTabPanelId('rewards')}
              aria-labelledby={getTabButtonId('rewards')}
              hidden={activeTab !== 'rewards'}
            >
              {activeTab === 'rewards' && isStreamerAdmin && <RewardsSettingsTab />}
            </div>

            <div
              role="tabpanel"
              id={getTabPanelId('obs')}
              aria-labelledby={getTabButtonId('obs')}
              hidden={activeTab !== 'obs'}
            >
              {activeTab === 'obs' && isStreamerAdmin && <ObsLinksSettingsTab />}
            </div>

            <div role="tabpanel" id={getTabPanelId('bot')} aria-labelledby={getTabButtonId('bot')} hidden={activeTab !== 'bot'}>
              {activeTab === 'bot' && isStreamerAdmin && <BotSettingsTab />}
            </div>

            <div role="tabpanel" aria-label={t('settings.accounts', { defaultValue: 'Accounts' })} hidden={activeTab !== 'accounts'}>
              {activeTab === 'accounts' && <AccountsSettingsTab />}
            </div>

            <div
              role="tabpanel"
              aria-label={t('admin.walletManagement', { defaultValue: 'Wallet management' })}
              hidden={activeTab !== 'wallets'}
            >
              {activeTab === 'wallets' && user?.role === 'admin' && <WalletManagementTab />}
            </div>

            <div role="tabpanel" aria-label={t('admin.entitlements', { defaultValue: 'Entitlements' })} hidden={activeTab !== 'entitlements'}>
              {activeTab === 'entitlements' && user?.role === 'admin' && <OwnerEntitlementsTab />}
            </div>

            <div role="tabpanel" aria-label={t('admin.promotions', { defaultValue: 'Promotions' })} hidden={activeTab !== 'promotions'}>
              {activeTab === 'promotions' && <PromotionManagementTab />}
            </div>

            <div role="tabpanel" aria-label={t('admin.statistics', { defaultValue: 'Statistics' })} hidden={activeTab !== 'statistics'}>
              {activeTab === 'statistics' && <ChannelStatisticsTab />}
            </div>

            <div role="tabpanel" aria-label={t('admin.betaAccess', { defaultValue: 'Beta access' })} hidden={activeTab !== 'beta'}>
              {activeTab === 'beta' && (user?.role === 'admin' ? <BetaAccessManagementTab /> : <BetaAccessSelfTab />)}
            </div>
          </div>
        </Suspense>
      </div>
    </PageShell>
  );
}


// ObsLinksSettings moved to src/features/settings/tabs/ObsLinksSettings.tsx

// Tabs moved into src/features/settings/tabs/* for faster navigation and search.

