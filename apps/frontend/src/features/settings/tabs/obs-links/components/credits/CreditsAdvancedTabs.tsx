import { useTranslation } from 'react-i18next';

import { CreditsTabLayout } from './tabs/CreditsTabLayout';
import { CreditsTabMotion } from './tabs/CreditsTabMotion';
import { CreditsTabSections } from './tabs/CreditsTabSections';
import { CreditsTabTypography } from './tabs/CreditsTabTypography';
import { CreditsTabVisual } from './tabs/CreditsTabVisual';

import type { CreditsSettingsState } from '../../hooks/useCreditsSettings';

type CreditsAdvancedTabsProps = {
  creditsSettings: CreditsSettingsState;
};

export function CreditsAdvancedTabs({ creditsSettings }: CreditsAdvancedTabsProps) {
  const { t } = useTranslation();
  const { creditsUiMode, creditsTab, setCreditsTab } = creditsSettings;

  if (creditsUiMode !== 'advanced') return null;

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {(
          [
            ['layout', t('admin.creditsTabLayout', { defaultValue: 'Layout' })],
            ['typography', t('admin.creditsTabTypography', { defaultValue: 'Typography' })],
            ['sections', t('admin.creditsTabSections', { defaultValue: 'Sections' })],
            ['visual', t('admin.creditsTabVisual', { defaultValue: 'Visual' })],
            ['motion', t('admin.creditsTabMotion', { defaultValue: 'Motion' })],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
              creditsTab === id
                ? 'bg-primary text-white border-primary'
                : 'bg-transparent text-gray-700 dark:text-gray-200 border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800'
            }`}
            onClick={() => setCreditsTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {creditsTab === 'layout' && <CreditsTabLayout creditsSettings={creditsSettings} />}
      {creditsTab === 'sections' && <CreditsTabSections creditsSettings={creditsSettings} />}
      {creditsTab === 'typography' && <CreditsTabTypography creditsSettings={creditsSettings} />}
      {creditsTab === 'visual' && <CreditsTabVisual creditsSettings={creditsSettings} />}
      {creditsTab === 'motion' && <CreditsTabMotion creditsSettings={creditsSettings} />}
    </>
  );
}
