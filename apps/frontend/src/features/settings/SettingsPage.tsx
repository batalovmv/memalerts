import { Suspense, lazy, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';

import Header from '@/components/Header';
import { ChannelSettings } from '@/features/settings/tabs/ChannelSettings';
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
  const [activeTab, setActiveTab] = useState<TabType>('settings');
  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false);
  const isStreamerAdmin = user?.role === 'streamer' || user?.role === 'admin';

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
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-xl">{t('common.loading')}</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900">
      <Header />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-6">
          <div className="flex items-center border-b border-secondary/30">
            {/* Tabs scroller (mobile) */}
            <div className="flex-1 overflow-x-auto whitespace-nowrap [-webkit-overflow-scrolling:touch] no-scrollbar">
              <div className="flex gap-2 sm:gap-4 items-center pr-2">
                {isStreamerAdmin && (
                  <button
                    onClick={() => setActiveTab('settings')}
                    className={`pb-2 px-4 transition-colors ${
                      activeTab === 'settings'
                        ? 'border-b-2 border-primary text-primary'
                        : 'text-gray-600 dark:text-gray-400 hover:text-primary dark:hover:text-primary'
                    }`}
                  >
                    {t('admin.channelDesign', { defaultValue: 'Оформление' })}
                  </button>
                )}
                {isStreamerAdmin && (
                  <button
                    onClick={() => setActiveTab('rewards')}
                    className={`pb-2 px-4 transition-colors ${
                      activeTab === 'rewards'
                        ? 'border-b-2 border-primary text-primary'
                        : 'text-gray-600 dark:text-gray-400 hover:text-primary dark:hover:text-primary'
                    }`}
                  >
                    {t('admin.rewards', { defaultValue: 'Награды' })}
                  </button>
                )}
                {isStreamerAdmin && (
                  <button
                    onClick={() => setActiveTab('obs')}
                    className={`pb-2 px-4 transition-colors ${
                      activeTab === 'obs'
                        ? 'border-b-2 border-primary text-primary'
                        : 'text-gray-600 dark:text-gray-400 hover:text-primary dark:hover:text-primary'
                    }`}
                  >
                    {t('admin.obsLinks', { defaultValue: 'OBS' })}
                  </button>
                )}
                {isStreamerAdmin && (
                  <button
                    onClick={() => setActiveTab('bot')}
                    className={`pb-2 px-4 transition-colors ${
                      activeTab === 'bot'
                        ? 'border-b-2 border-primary text-primary'
                        : 'text-gray-600 dark:text-gray-400 hover:text-primary dark:hover:text-primary'
                    }`}
                  >
                    {t('admin.bot', { defaultValue: 'Bot' })}
                  </button>
                )}
              </div>
            </div>

            {/* More menu (fixed on the right) */}
            <div className="relative flex-shrink-0 pl-2">
              <button
                onClick={() => setIsMoreMenuOpen(!isMoreMenuOpen)}
                className={`pb-2 px-3 transition-colors flex items-center gap-1 ${
                  ['wallets', 'promotions', 'statistics', 'beta'].includes(activeTab)
                    ? 'border-b-2 border-primary text-primary'
                    : 'text-gray-600 dark:text-gray-400 hover:text-primary dark:hover:text-primary'
                }`}
                aria-label={t('admin.more', { defaultValue: 'More' })}
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <circle cx="5" cy="12" r="1.8" />
                  <circle cx="12" cy="12" r="1.8" />
                  <circle cx="19" cy="12" r="1.8" />
                </svg>
              </button>

              {/* Dropdown меню */}
              {isMoreMenuOpen && (
                <>
                  <div 
                    className="fixed inset-0 z-10" 
                    onClick={() => setIsMoreMenuOpen(false)}
                  />
                  <div className="absolute right-0 mt-2 w-56 glass rounded-xl shadow-xl ring-1 ring-black/5 dark:ring-white/10 z-20 py-1">
                    <button
                      onClick={() => {
                        setActiveTab('statistics');
                        setIsMoreMenuOpen(false);
                      }}
                      className={`w-full text-left px-4 py-2 text-sm transition-colors ${
                        activeTab === 'statistics'
                          ? 'bg-primary/10 text-primary'
                          : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                      }`}
                    >
                      {t('admin.statistics')}
                    </button>
                    <button
                      onClick={() => {
                        setActiveTab('promotions');
                        setIsMoreMenuOpen(false);
                      }}
                      className={`w-full text-left px-4 py-2 text-sm transition-colors ${
                        activeTab === 'promotions'
                          ? 'bg-primary/10 text-primary'
                          : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                      }`}
                    >
                      {t('admin.promotions')}
                    </button>
                    <div className="border-t border-black/5 dark:border-white/10 my-1" />

                    {(user?.role === 'admin' || isStreamerAdmin) && (
                      <button
                        onClick={() => {
                          setActiveTab('wallets');
                          setIsMoreMenuOpen(false);
                        }}
                        className={`w-full text-left px-4 py-2 text-sm transition-colors ${
                          activeTab === 'wallets'
                            ? 'bg-primary/10 text-primary'
                            : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                        }`}
                      >
                        {t('admin.walletManagement')}
                      </button>
                    )}

                    {user?.role === 'admin' && (
                      <button
                        onClick={() => {
                          setActiveTab('entitlements');
                          setIsMoreMenuOpen(false);
                        }}
                        className={`w-full text-left px-4 py-2 text-sm transition-colors ${
                          activeTab === 'entitlements'
                            ? 'bg-primary/10 text-primary'
                            : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                        }`}
                      >
                        {t('admin.entitlements', { defaultValue: 'Entitlements' })}
                      </button>
                    )}

                    <button
                      onClick={() => {
                        setActiveTab('beta');
                        setIsMoreMenuOpen(false);
                      }}
                      className={`w-full text-left px-4 py-2 text-sm transition-colors ${
                        activeTab === 'beta'
                          ? 'bg-primary/10 text-primary'
                          : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                      }`}
                    >
                      {t('admin.betaAccess')}
                    </button>

                    <button
                      onClick={() => {
                        setActiveTab('accounts');
                        setIsMoreMenuOpen(false);
                      }}
                      className={`w-full text-left px-4 py-2 text-sm transition-colors ${
                        activeTab === 'accounts'
                          ? 'bg-primary/10 text-primary'
                          : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                      }`}
                    >
                      {t('settings.accounts', { defaultValue: 'Accounts' })}
                    </button>

                    {/* walletManagement entry is rendered above once (admin OR streamer admin) */}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        <Suspense
          fallback={
            <div className="py-10 text-center text-gray-600 dark:text-gray-400">
              {t('common.loading', { defaultValue: 'Loading…' })}
            </div>
          }
        >
          {activeTab === 'settings' && isStreamerAdmin && <ChannelSettings />}

          {activeTab === 'rewards' && isStreamerAdmin && <RewardsSettingsTab />}

          {activeTab === 'obs' && isStreamerAdmin && <ObsLinksSettingsTab />}

          {activeTab === 'bot' && isStreamerAdmin && <BotSettingsTab />}

          {activeTab === 'accounts' && <AccountsSettingsTab />}

          {activeTab === 'wallets' && user?.role === 'admin' && <WalletManagementTab />}

          {activeTab === 'entitlements' && user?.role === 'admin' && <OwnerEntitlementsTab />}

          {activeTab === 'promotions' && <PromotionManagementTab />}

          {activeTab === 'statistics' && <ChannelStatisticsTab />}

          {activeTab === 'beta' &&
            (user?.role === 'admin' ? <BetaAccessManagementTab /> : <BetaAccessSelfTab />)}
        </Suspense>
      </main>
    </div>
  );
}


// ObsLinksSettings moved to src/features/settings/tabs/ObsLinksSettings.tsx

// Tabs moved into src/features/settings/tabs/* for faster navigation and search.

