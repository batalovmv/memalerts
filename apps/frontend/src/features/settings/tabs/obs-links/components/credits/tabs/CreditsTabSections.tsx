import { useTranslation } from 'react-i18next';

import type { CreditsSettingsState } from '../../../hooks/useCreditsSettings';

import { Button } from '@/shared/ui';

type CreditsTabSectionsProps = {
  creditsSettings: CreditsSettingsState;
};

export function CreditsTabSections({ creditsSettings }: CreditsTabSectionsProps) {
  const { t } = useTranslation();
  const {
    creditsShowDonors,
    setCreditsShowDonors,
    creditsShowChatters,
    setCreditsShowChatters,
    setCreditsSectionsOrder,
    creditsSectionGapPx,
    setCreditsSectionGapPx,
    creditsLineGapPx,
    setCreditsLineGapPx,
  } = creditsSettings;

  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-sm text-gray-800 dark:text-gray-100">
        <input
          type="checkbox"
          checked={creditsShowDonors}
          onChange={(e) => setCreditsShowDonors(e.target.checked)}
          className="h-4 w-4 rounded border-white/20 dark:border-white/10 bg-white/60 dark:bg-white/10"
        />
        {t('admin.creditsShowDonors', { defaultValue: 'Донаты (DonationAlerts)' })}
      </label>
      <label className="flex items-center gap-2 text-sm text-gray-800 dark:text-gray-100">
        <input
          type="checkbox"
          checked={creditsShowChatters}
          onChange={(e) => setCreditsShowChatters(e.target.checked)}
          className="h-4 w-4 rounded border-white/20 dark:border-white/10 bg-white/60 dark:bg-white/10"
        />
        {t('admin.creditsShowChatters', { defaultValue: 'Чат (Twitch)' })}
      </label>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="secondary" className="glass-btn" onClick={() => setCreditsSectionsOrder(['donors', 'chatters'])}>
          {t('admin.creditsOrderDonorsFirst', { defaultValue: 'Донаты  Чат' })}
        </Button>
        <Button type="button" size="sm" variant="secondary" className="glass-btn" onClick={() => setCreditsSectionsOrder(['chatters', 'donors'])}>
          {t('admin.creditsOrderChattersFirst', { defaultValue: 'Чат  Донаты' })}
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">
            {t('admin.creditsSectionGap', { defaultValue: 'Отступ между секциями' })}
          </label>
          <input
            type="number"
            min={0}
            max={120}
            value={creditsSectionGapPx}
            onChange={(e) => setCreditsSectionGapPx(Number(e.target.value) || 0)}
            className="w-full px-3 py-2 rounded-lg bg-white/60 dark:bg-white/10 border border-white/20 dark:border-white/10 text-gray-900 dark:text-white"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">
            {t('admin.creditsLineGap', { defaultValue: 'Отступ между строками' })}
          </label>
          <input
            type="number"
            min={0}
            max={80}
            value={creditsLineGapPx}
            onChange={(e) => setCreditsLineGapPx(Number(e.target.value) || 0)}
            className="w-full px-3 py-2 rounded-lg bg-white/60 dark:bg-white/10 border border-white/20 dark:border-white/10 text-gray-900 dark:text-white"
          />
        </div>
      </div>
    </div>
  );
}
