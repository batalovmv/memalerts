import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';

import type { SettingsTab } from '@/features/settings/model/types';
import type { User } from '@/types';
import type { KeyboardEvent } from 'react';

import { getSettingsTabLabel } from '@/features/settings/model/tabLabels';
import { SettingsMoreMenu } from '@/features/settings/ui/SettingsMoreMenu';

type SettingsTabsBarProps = {
  activeTab: SettingsTab;
  visibleTabs: SettingsTab[];
  isMoreTabActive: boolean;
  isStreamerAdmin: boolean;
  user: User;
  onSelectTab: (tab: SettingsTab) => void;
  onTabKeyDown: (event: KeyboardEvent<HTMLButtonElement>, tab: SettingsTab) => void;
  getTabButtonId: (tab: SettingsTab) => string;
  getTabPanelId: (tab: SettingsTab) => string;
};

export function SettingsTabsBar({
  activeTab,
  visibleTabs,
  isMoreTabActive,
  isStreamerAdmin,
  user,
  onSelectTab,
  onTabKeyDown,
  getTabButtonId,
  getTabPanelId,
}: SettingsTabsBarProps) {
  const { t } = useTranslation();
  const tabBase =
    'relative px-3 py-2 text-sm font-semibold whitespace-nowrap rounded-lg transition-colors focus-visible:outline-none';
  const tabInactive = 'text-gray-600 dark:text-gray-300 hover:bg-black/5 dark:hover:bg-white/10';
  const tabActive =
    "text-gray-900 dark:text-white after:content-[''] after:absolute after:left-2 after:right-2 after:-bottom-0.5 after:h-0.5 after:rounded-full after:bg-primary";

  return (
    <div className="flex items-center px-3 sm:px-6 pt-3 pb-2 gap-2">
      <div className="flex-1 overflow-x-auto whitespace-nowrap [-webkit-overflow-scrolling:touch] no-scrollbar">
        <div className="flex gap-1 sm:gap-2 items-center" role="tablist" aria-label={t('settings.tabs', { defaultValue: 'Settings tabs' })}>
          {visibleTabs.map((tab, idx) => {
            const isActive = activeTab === tab;
            const label = getSettingsTabLabel(t, tab);
            const showDivider = isMoreTabActive && idx === visibleTabs.length - 1 && visibleTabs.length > 1;

            return (
              <Fragment key={tab}>
                {showDivider ? <span className="mx-1 h-5 w-px bg-black/10 dark:bg-white/10" aria-hidden="true" /> : null}
                <button
                  onClick={() => onSelectTab(tab)}
                  onKeyDown={(e) => onTabKeyDown(e, tab)}
                  className={`${tabBase} ${isActive ? tabActive : tabInactive}`}
                  type="button"
                  id={getTabButtonId(tab)}
                  role="tab"
                  aria-selected={isActive}
                  aria-controls={getTabPanelId(tab)}
                  tabIndex={isActive ? 0 : -1}
                >
                  {label}
                </button>
              </Fragment>
            );
          })}
        </div>
      </div>

      <div className="relative flex-shrink-0 ml-1">
        <SettingsMoreMenu
          activeTab={activeTab}
          isMoreTabActive={isMoreTabActive}
          isStreamerAdmin={isStreamerAdmin}
          user={user}
          onSelectTab={onSelectTab}
        />
      </div>
    </div>
  );
}
