import { useTranslation } from 'react-i18next';

import type { CreditsSettingsState } from '../../../hooks/useCreditsSettings';
import type { CreditsScrollDirection } from '../../../types';

type CreditsTabMotionProps = {
  creditsSettings: CreditsSettingsState;
};

export function CreditsTabMotion({ creditsSettings }: CreditsTabMotionProps) {
  const { t } = useTranslation();
  const {
    creditsScrollDirection,
    setCreditsScrollDirection,
    creditsLoop,
    setCreditsLoop,
    creditsStartDelayMs,
    setCreditsStartDelayMs,
    creditsEndFadeMs,
    setCreditsEndFadeMs,
    creditsFadeInMs,
    setCreditsFadeInMs,
  } = creditsSettings;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div className="space-y-3">
        <div>
          <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">
            {t('admin.creditsScrollDirection', { defaultValue: 'Направление' })}
          </label>
          <select
            value={creditsScrollDirection}
            onChange={(e) => setCreditsScrollDirection(e.target.value as CreditsScrollDirection)}
            className="w-full px-3 py-2 rounded-lg bg-white/60 dark:bg-white/10 border border-white/20 dark:border-white/10 text-gray-900 dark:text-white"
          >
            <option value="up">{t('admin.up', { defaultValue: 'Up' })}</option>
            <option value="down">{t('admin.down', { defaultValue: 'Down' })}</option>
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-800 dark:text-gray-100">
          <input
            type="checkbox"
            checked={creditsLoop}
            onChange={(e) => setCreditsLoop(e.target.checked)}
            className="h-4 w-4 rounded border-white/20 dark:border-white/10 bg-white/60 dark:bg-white/10"
          />
          {t('admin.creditsLoop', { defaultValue: 'Loop' })}
        </label>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">
              {t('admin.creditsStartDelay', { defaultValue: 'Start delay (ms)' })}
            </label>
            <input
              type="number"
              min={0}
              max={60000}
              value={creditsStartDelayMs}
              onChange={(e) => setCreditsStartDelayMs(Number(e.target.value) || 0)}
              className="w-full px-3 py-2 rounded-lg bg-white/60 dark:bg-white/10 border border-white/20 dark:border-white/10 text-gray-900 dark:text-white"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">
              {t('admin.creditsEndFade', { defaultValue: 'End fade (ms)' })}
            </label>
            <input
              type="number"
              min={0}
              max={60000}
              value={creditsEndFadeMs}
              onChange={(e) => setCreditsEndFadeMs(Number(e.target.value) || 0)}
              className="w-full px-3 py-2 rounded-lg bg-white/60 dark:bg-white/10 border border-white/20 dark:border-white/10 text-gray-900 dark:text-white"
              disabled={creditsLoop}
            />
          </div>
        </div>
      </div>
      <div className="space-y-3">
        <div>
          <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">
            {t('admin.creditsFadeIn', { defaultValue: 'Fade-in (ms)' })}
          </label>
          <input
            type="number"
            min={0}
            max={5000}
            value={creditsFadeInMs}
            onChange={(e) => setCreditsFadeInMs(Number(e.target.value) || 0)}
            className="w-full px-3 py-2 rounded-lg bg-white/60 dark:bg-white/10 border border-white/20 dark:border-white/10 text-gray-900 dark:text-white"
          />
        </div>
      </div>
    </div>
  );
}
