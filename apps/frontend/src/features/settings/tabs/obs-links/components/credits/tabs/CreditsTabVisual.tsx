import { useTranslation } from 'react-i18next';

import type { CreditsBackgroundMode } from '../../../types';
import type { CreditsSettingsState } from '../../../hooks/useCreditsSettings';

type CreditsTabVisualProps = {
  creditsSettings: CreditsSettingsState;
};

export function CreditsTabVisual({ creditsSettings }: CreditsTabVisualProps) {
  const { t } = useTranslation();
  const {
    creditsBackgroundMode,
    setCreditsBackgroundMode,
    creditsBgColor,
    setCreditsBgColor,
    creditsBgOpacity,
    setCreditsBgOpacity,
    creditsBlur,
    setCreditsBlur,
    creditsRadius,
    setCreditsRadius,
    creditsBorderEnabled,
    setCreditsBorderEnabled,
    creditsBorderWidth,
    setCreditsBorderWidth,
    creditsBorderColor,
    setCreditsBorderColor,
    creditsShadowBlur,
    setCreditsShadowBlur,
    creditsShadowOpacity,
    setCreditsShadowOpacity,
  } = creditsSettings;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div className="space-y-3">
        <div>
          <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">
            {t('admin.creditsBackgroundMode', { defaultValue: 'Режим фона' })}
          </label>
          <select
            value={creditsBackgroundMode}
            onChange={(e) => setCreditsBackgroundMode(e.target.value as CreditsBackgroundMode)}
            className="w-full px-3 py-2 rounded-lg bg-white/60 dark:bg-white/10 border border-white/20 dark:border-white/10 text-gray-900 dark:text-white"
          >
            <option value="transparent">{t('admin.transparent', { defaultValue: 'Transparent' })}</option>
            <option value="card">{t('admin.card', { defaultValue: 'Card' })}</option>
            <option value="full">{t('admin.fullscreen', { defaultValue: 'Full' })}</option>
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">
              {t('admin.color', { defaultValue: 'Цвет' })}
            </label>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={creditsBgColor}
                onChange={(e) => setCreditsBgColor(String(e.target.value || '').toLowerCase())}
                className="h-10 w-14 rounded-lg border border-white/20 dark:border-white/10 bg-transparent"
              />
              <div className="text-xs text-gray-600 dark:text-gray-300 font-mono">{creditsBgColor}</div>
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">
              {t('admin.opacity', { defaultValue: 'Прозрачность' })}: {Math.round(creditsBgOpacity * 100)}%
            </label>
            <input
              type="range"
              min={0}
              max={0.85}
              step={0.01}
              value={creditsBgOpacity}
              onChange={(e) => setCreditsBgOpacity(parseFloat(e.target.value))}
              className="w-full"
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">
              {t('admin.blur', { defaultValue: 'Blur' })}
            </label>
            <input
              type="number"
              min={0}
              max={40}
              value={creditsBlur}
              onChange={(e) => setCreditsBlur(Number(e.target.value) || 0)}
              className="w-full px-3 py-2 rounded-lg bg-white/60 dark:bg-white/10 border border-white/20 dark:border-white/10 text-gray-900 dark:text-white"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">
              {t('admin.radius', { defaultValue: 'Скругление' })}
            </label>
            <input
              type="number"
              min={0}
              max={80}
              value={creditsRadius}
              onChange={(e) => setCreditsRadius(Number(e.target.value) || 0)}
              className="w-full px-3 py-2 rounded-lg bg-white/60 dark:bg-white/10 border border-white/20 dark:border-white/10 text-gray-900 dark:text-white"
            />
          </div>
        </div>
      </div>
      <div className="space-y-3">
        <label className="flex items-center gap-2 text-sm text-gray-800 dark:text-gray-100">
          <input
            type="checkbox"
            checked={creditsBorderEnabled}
            onChange={(e) => setCreditsBorderEnabled(e.target.checked)}
            className="h-4 w-4 rounded border-white/20 dark:border-white/10 bg-white/60 dark:bg-white/10"
          />
          {t('admin.border', { defaultValue: 'Border' })}
        </label>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">
              {t('admin.borderWidth', { defaultValue: 'Width' })}
            </label>
            <input
              type="number"
              min={0}
              max={16}
              value={creditsBorderWidth}
              onChange={(e) => setCreditsBorderWidth(Number(e.target.value) || 0)}
              className="w-full px-3 py-2 rounded-lg bg-white/60 dark:bg-white/10 border border-white/20 dark:border-white/10 text-gray-900 dark:text-white"
              disabled={!creditsBorderEnabled}
            />
          </div>
          <div>
            <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">
              {t('admin.borderColor', { defaultValue: 'Color' })}
            </label>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={creditsBorderColor}
                onChange={(e) => setCreditsBorderColor(String(e.target.value || '').toLowerCase())}
                className="h-10 w-14 rounded-lg border border-white/20 dark:border-white/10 bg-transparent"
                disabled={!creditsBorderEnabled}
              />
              <div className="text-xs text-gray-600 dark:text-gray-300 font-mono">{creditsBorderColor}</div>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">
              {t('admin.shadow', { defaultValue: 'Тень (blur)' })}
            </label>
            <input
              type="number"
              min={0}
              max={240}
              value={creditsShadowBlur}
              onChange={(e) => setCreditsShadowBlur(Number(e.target.value) || 0)}
              className="w-full px-3 py-2 rounded-lg bg-white/60 dark:bg-white/10 border border-white/20 dark:border-white/10 text-gray-900 dark:text-white"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">
              {t('admin.shadowOpacity', { defaultValue: 'Тень (opacity)' })}: {Math.round(creditsShadowOpacity * 100)}%
            </label>
            <input
              type="range"
              min={0}
              max={1}
              step={0.02}
              value={creditsShadowOpacity}
              onChange={(e) => setCreditsShadowOpacity(parseFloat(e.target.value))}
              className="w-full"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
