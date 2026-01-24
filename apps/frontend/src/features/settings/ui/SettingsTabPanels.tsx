import { Suspense, lazy } from 'react';
import { useTranslation } from 'react-i18next';

import type { SettingsTab } from '@/features/settings/model/types';
import type { User } from '@/types';

import { getSettingsTabLabel } from '@/features/settings/model/tabLabels';
import { ChannelSettings } from '@/features/settings/tabs/ChannelSettings';
import { Spinner } from '@/shared/ui';

const RewardsSettingsTab = lazy(() =>
  import('@/features/settings/tabs/RewardsSettings').then((m) => ({ default: m.RewardsSettings })),
);
const ObsLinksSettingsTab = lazy(() =>
  import('@/features/settings/tabs/ObsLinksSettings').then((m) => ({ default: m.ObsLinksSettings })),
);
const BotSettingsTab = lazy(() => import('@/features/settings/tabs/BotSettings').then((m) => ({ default: m.BotSettings })));
const AccountsSettingsTab = lazy(() =>
  import('@/features/settings/tabs/AccountsSettings').then((m) => ({ default: m.AccountsSettings })),
);
const WalletManagementTab = lazy(() =>
  import('@/features/settings/tabs/WalletManagement').then((m) => ({ default: m.WalletManagement })),
);
const OwnerEntitlementsTab = lazy(() =>
  import('@/features/settings/tabs/OwnerEntitlements').then((m) => ({ default: m.OwnerEntitlements })),
);
const OwnerMemeAssetsModerationTab = lazy(() =>
  import('@/features/settings/tabs/OwnerMemeAssetsModeration').then((m) => ({ default: m.OwnerMemeAssetsModeration })),
);
const OwnerModeratorsTab = lazy(() =>
  import('@/features/settings/tabs/OwnerModerators').then((m) => ({ default: m.OwnerModerators })),
);
const OwnerAiStatusTab = lazy(() =>
  import('@/features/settings/tabs/OwnerAiStatus').then((m) => ({ default: m.OwnerAiStatus })),
);
const OwnerTagModerationTab = lazy(() =>
  import('@/features/settings/tabs/OwnerTagModeration').then((m) => ({ default: m.OwnerTagModeration })),
);
const PromotionManagementTab = lazy(() =>
  import('@/features/settings/tabs/PromotionManagement').then((m) => ({ default: m.PromotionManagement })),
);
const ChannelStatisticsTab = lazy(() =>
  import('@/features/settings/tabs/ChannelStatistics').then((m) => ({ default: m.ChannelStatistics })),
);
const BetaAccessManagementTab = lazy(() =>
  import('@/features/settings/tabs/BetaAccessManagement').then((m) => ({ default: m.BetaAccessManagement })),
);
const BetaAccessSelfTab = lazy(() => import('@/features/settings/tabs/BetaAccessSelf').then((m) => ({ default: m.BetaAccessSelf })));

type SettingsTabPanelsProps = {
  activeTab: SettingsTab;
  isStreamerAdmin: boolean;
  user: User;
  getTabButtonId: (tab: SettingsTab) => string;
  getTabPanelId: (tab: SettingsTab) => string;
};

export function SettingsTabPanels({ activeTab, isStreamerAdmin, user, getTabButtonId, getTabPanelId }: SettingsTabPanelsProps) {
  const { t } = useTranslation();
  const tabLabel = (tab: SettingsTab) => getSettingsTabLabel(t, tab);

  return (
    <Suspense
      fallback={
        <div className="py-10 flex items-center justify-center gap-3 text-gray-600 dark:text-gray-300">
          <Spinner className="h-5 w-5" />
          <span>{t('common.loading', { defaultValue: 'Loading…' })}</span>
        </div>
      }
    >
      <div className="p-4 sm:p-6">
        <div role="tabpanel" id={getTabPanelId('settings')} aria-labelledby={getTabButtonId('settings')} hidden={activeTab !== 'settings'}>
          {activeTab === 'settings' && isStreamerAdmin && <ChannelSettings />}
        </div>

        <div role="tabpanel" id={getTabPanelId('rewards')} aria-labelledby={getTabButtonId('rewards')} hidden={activeTab !== 'rewards'}>
          {activeTab === 'rewards' && isStreamerAdmin && <RewardsSettingsTab />}
        </div>

        <div role="tabpanel" id={getTabPanelId('obs')} aria-labelledby={getTabButtonId('obs')} hidden={activeTab !== 'obs'}>
          {activeTab === 'obs' && isStreamerAdmin && <ObsLinksSettingsTab />}
        </div>

        <div role="tabpanel" id={getTabPanelId('bot')} aria-labelledby={getTabButtonId('bot')} hidden={activeTab !== 'bot'}>
          {activeTab === 'bot' && isStreamerAdmin && <BotSettingsTab />}
        </div>

        <div role="tabpanel" aria-label={tabLabel('accounts')} hidden={activeTab !== 'accounts'}>
          {activeTab === 'accounts' && <AccountsSettingsTab />}
        </div>

        <div role="tabpanel" aria-label={tabLabel('wallets')} hidden={activeTab !== 'wallets'}>
          {activeTab === 'wallets' && user?.role === 'admin' && <WalletManagementTab />}
        </div>

        <div role="tabpanel" aria-label={tabLabel('entitlements')} hidden={activeTab !== 'entitlements'}>
          {activeTab === 'entitlements' && user?.role === 'admin' && <OwnerEntitlementsTab />}
        </div>

        <div role="tabpanel" aria-label={tabLabel('ownerMemeAssets')} hidden={activeTab !== 'ownerMemeAssets'}>
          {activeTab === 'ownerMemeAssets' && user?.role === 'admin' && <OwnerMemeAssetsModerationTab />}
        </div>

        <div role="tabpanel" aria-label={tabLabel('ownerModerators')} hidden={activeTab !== 'ownerModerators'}>
          {activeTab === 'ownerModerators' && user?.role === 'admin' && <OwnerModeratorsTab />}
        </div>

        <div role="tabpanel" aria-label={tabLabel('ownerAiStatus')} hidden={activeTab !== 'ownerAiStatus'}>
          {activeTab === 'ownerAiStatus' && user?.role === 'admin' && <OwnerAiStatusTab />}
        </div>

        <div role="tabpanel" aria-label={tabLabel('ownerTagModeration')} hidden={activeTab !== 'ownerTagModeration'}>
          {activeTab === 'ownerTagModeration' && user?.role === 'admin' && <OwnerTagModerationTab />}
        </div>

        <div role="tabpanel" aria-label={tabLabel('promotions')} hidden={activeTab !== 'promotions'}>
          {activeTab === 'promotions' && <PromotionManagementTab />}
        </div>

        <div role="tabpanel" aria-label={tabLabel('statistics')} hidden={activeTab !== 'statistics'}>
          {activeTab === 'statistics' && <ChannelStatisticsTab />}
        </div>

        <div role="tabpanel" aria-label={tabLabel('beta')} hidden={activeTab !== 'beta'}>
          {activeTab === 'beta' && (user?.role === 'admin' ? <BetaAccessManagementTab /> : <BetaAccessSelfTab />)}
        </div>
      </div>
    </Suspense>
  );
}
