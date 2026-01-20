import { useTranslation } from 'react-i18next';

import type { CreditsAnchorX, CreditsAnchorY } from '../../../types';
import type { CreditsSettingsState } from '../../../hooks/useCreditsSettings';

type CreditsTabLayoutProps = {
  creditsSettings: CreditsSettingsState;
};

export function CreditsTabLayout({ creditsSettings }: CreditsTabLayoutProps) {
  const { t } = useTranslation();
  const {
    creditsAnchorX,
    setCreditsAnchorX,
    creditsAnchorY,
    setCreditsAnchorY,
    creditsMaxWidthPx,
    setCreditsMaxWidthPx,
    creditsMaxHeightVh,
    setCreditsMaxHeightVh,
    creditsIndentPx,
    setCreditsIndentPx,
    creditsLineHeight,
    setCreditsLineHeight,
    creditsLetterSpacing,
    setCreditsLetterSpacing,
  } = creditsSettings;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">
              {t('admin.creditsAnchorX', { defaultValue: 'Anchor X' })}
            </label>
            <select
              value={creditsAnchorX}
              onChange={(e) => setCreditsAnchorX(e.target.value as CreditsAnchorX)}
              className="w-full px-3 py-2 rounded-lg bg-white/60 dark:bg-white/10 border border-white/20 dark:border-white/10 text-gray-900 dark:text-white"
            >
              <option value="left">{t('admin.alignLeft', { defaultValue: 'Left' })}</option>
              <option value="center">{t('admin.alignCenter', { defaultValue: 'Center' })}</option>
              <option value="right">{t('admin.alignRight', { defaultValue: 'Right' })}</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">
              {t('admin.creditsAnchorY', { defaultValue: 'Anchor Y' })}
            </label>
            <select
              value={creditsAnchorY}
              onChange={(e) => setCreditsAnchorY(e.target.value as CreditsAnchorY)}
              className="w-full px-3 py-2 rounded-lg bg-white/60 dark:bg-white/10 border border-white/20 dark:border-white/10 text-gray-900 dark:text-white"
            >
              <option value="top">{t('admin.alignTop', { defaultValue: 'Top' })}</option>
              <option value="center">{t('admin.alignCenter', { defaultValue: 'Center' })}</option>
              <option value="bottom">{t('admin.alignBottom', { defaultValue: 'Bottom' })}</option>
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">
              {t('admin.creditsMaxWidth', { defaultValue: 'Max width (px)' })}
            </label>
            <input
              type="number"
              min={240}
              max={2400}
              value={creditsMaxWidthPx}
              onChange={(e) => setCreditsMaxWidthPx(Number(e.target.value) || 240)}
              className="w-full px-3 py-2 rounded-lg bg-white/60 dark:bg-white/10 border border-white/20 dark:border-white/10 text-gray-900 dark:text-white"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">
              {t('admin.creditsMaxHeight', { defaultValue: 'Max height (vh)' })}
            </label>
            <input
              type="number"
              min={20}
              max={100}
              value={creditsMaxHeightVh}
              onChange={(e) => setCreditsMaxHeightVh(Number(e.target.value) || 20)}
              className="w-full px-3 py-2 rounded-lg bg-white/60 dark:bg-white/10 border border-white/20 dark:border-white/10 text-gray-900 dark:text-white"
            />
          </div>
        </div>
      </div>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">
              {t('admin.creditsIndent', { defaultValue: 'Indent (px)' })}
            </label>
            <input
              type="number"
              min={0}
              max={240}
              value={creditsIndentPx}
              onChange={(e) => setCreditsIndentPx(Number(e.target.value) || 0)}
              className="w-full px-3 py-2 rounded-lg bg-white/60 dark:bg-white/10 border border-white/20 dark:border-white/10 text-gray-900 dark:text-white"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">
              {t('admin.lineHeight', { defaultValue: 'Line height' })}
            </label>
            <input
              type="number"
              min={0.9}
              max={2.2}
              step={0.05}
              value={creditsLineHeight}
              onChange={(e) => setCreditsLineHeight(Number(e.target.value) || 1.15)}
              className="w-full px-3 py-2 rounded-lg bg-white/60 dark:bg-white/10 border border-white/20 dark:border-white/10 text-gray-900 dark:text-white"
            />
          </div>
        </div>
        <div>
          <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">
            {t('admin.letterSpacing', { defaultValue: 'Letter spacing (px)' })}
          </label>
          <input
            type="number"
            min={-2}
            max={8}
            step={0.1}
            value={creditsLetterSpacing}
            onChange={(e) => setCreditsLetterSpacing(Number(e.target.value) || 0)}
            className="w-full px-3 py-2 rounded-lg bg-white/60 dark:bg-white/10 border border-white/20 dark:border-white/10 text-gray-900 dark:text-white"
          />
        </div>
      </div>
    </div>
  );
}
