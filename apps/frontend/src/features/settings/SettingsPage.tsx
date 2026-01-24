import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';

import Header from '@/components/Header';
import { useSettingsTabs } from '@/features/settings/model/useSettingsTabs';
import { SettingsTabPanels } from '@/features/settings/ui/SettingsTabPanels';
import { SettingsTabsBar } from '@/features/settings/ui/SettingsTabsBar';
import { getEffectiveUserMode } from '@/shared/lib/uiMode';
import { PageShell, Spinner } from '@/shared/ui';
import { useAppSelector } from '@/store/hooks';

const SettingsPage = memo(function SettingsPage() {
  const { t } = useTranslation();
  const { user, loading: authLoading } = useAppSelector((state) => state.auth);
  const navigate = useNavigate();
  const location = useLocation();
  const uiMode = getEffectiveUserMode(user);

  const {
    activeTab,
    setActiveTab,
    isStreamerAdmin,
    isMoreTabActive,
    visibleTabs,
    getTabButtonId,
    getTabPanelId,
    handleTabKeyDown,
  } = useSettingsTabs({ user, authLoading, uiMode, location, navigate });

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
          <SettingsTabsBar
            activeTab={activeTab}
            visibleTabs={visibleTabs}
            isMoreTabActive={isMoreTabActive}
            isStreamerAdmin={isStreamerAdmin}
            user={user}
            onSelectTab={setActiveTab}
            onTabKeyDown={handleTabKeyDown}
            getTabButtonId={getTabButtonId}
            getTabPanelId={getTabPanelId}
          />
          <SettingsTabPanels
            activeTab={activeTab}
            isStreamerAdmin={isStreamerAdmin}
            user={user}
            getTabButtonId={getTabButtonId}
            getTabPanelId={getTabPanelId}
          />
        </div>
      </div>
    </PageShell>
  );
});

export default SettingsPage;
