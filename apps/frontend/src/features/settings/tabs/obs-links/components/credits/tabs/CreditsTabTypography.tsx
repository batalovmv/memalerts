import { useTranslation } from 'react-i18next';

import type { CreditsTitleTransform } from '../../../types';
import type { CreditsSettingsState } from '../../../hooks/useCreditsSettings';

type CreditsTabTypographyProps = {
  creditsSettings: CreditsSettingsState;
};

export function CreditsTabTypography({ creditsSettings }: CreditsTabTypographyProps) {
  const { t } = useTranslation();
  const {
    creditsFontWeight,
    setCreditsFontWeight,
    creditsFontColor,
    setCreditsFontColor,
    creditsTextShadowBlur,
    setCreditsTextShadowBlur,
    creditsTextShadowOpacity,
    setCreditsTextShadowOpacity,
    creditsTextShadowColor,
    setCreditsTextShadowColor,
    creditsTextStrokeWidth,
    setCreditsTextStrokeWidth,
    creditsTextStrokeOpacity,
    setCreditsTextStrokeOpacity,
    creditsTextStrokeColor,
    setCreditsTextStrokeColor,
    creditsTitleEnabled,
    setCreditsTitleEnabled,
    creditsTitleSize,
    setCreditsTitleSize,
    creditsTitleTransform,
    setCreditsTitleTransform,
    creditsTitleColor,
    setCreditsTitleColor,
    creditsTitleShadowBlur,
    setCreditsTitleShadowBlur,
    creditsTitleShadowOpacity,
    setCreditsTitleShadowOpacity,
    creditsTitleShadowColor,
    setCreditsTitleShadowColor,
    creditsTitleStrokeWidth,
    setCreditsTitleStrokeWidth,
    creditsTitleStrokeOpacity,
    setCreditsTitleStrokeOpacity,
    creditsTitleStrokeColor,
    setCreditsTitleStrokeColor,
  } = creditsSettings;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div className="space-y-3">
        <div>
          <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">
            {t('admin.fontWeight', { defaultValue: 'Насыщенность' })}
          </label>
          <input
            type="number"
            min={300}
            max={900}
            step={50}
            value={creditsFontWeight}
            onChange={(e) => setCreditsFontWeight(Number(e.target.value) || 300)}
            className="w-full px-3 py-2 rounded-lg bg-white/60 dark:bg-white/10 border border-white/20 dark:border-white/10 text-gray-900 dark:text-white"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">{t('admin.color', { defaultValue: 'Цвет' })}</label>
          <div className="flex items-center gap-3">
            <input
              type="color"
              value={creditsFontColor}
              onChange={(e) => setCreditsFontColor(String(e.target.value || '').toLowerCase())}
              className="h-10 w-14 rounded-lg border border-white/20 dark:border-white/10 bg-transparent"
            />
            <div className="text-xs text-gray-600 dark:text-gray-300 font-mono">{creditsFontColor}</div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">
              {t('admin.creditsTextShadow', { defaultValue: 'Тень текста (blur)' })}
            </label>
            <input
              type="number"
              min={0}
              max={120}
              step={1}
              value={creditsTextShadowBlur}
              onChange={(e) => setCreditsTextShadowBlur(Number(e.target.value) || 0)}
              className="w-full px-3 py-2 rounded-lg bg-white/60 dark:bg-white/10 border border-white/20 dark:border-white/10 text-gray-900 dark:text-white"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">
              {t('admin.creditsTextShadowOpacity', { defaultValue: 'Тень текста (opacity)' })}:{' '}
              {Math.round(creditsTextShadowOpacity * 100)}%
            </label>
            <input
              type="range"
              min={0}
              max={1}
              step={0.02}
              value={creditsTextShadowOpacity}
              onChange={(e) => setCreditsTextShadowOpacity(parseFloat(e.target.value))}
              className="w-full"
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">
              {t('admin.creditsTextShadowColor', { defaultValue: 'Тень текста (color)' })}
            </label>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={creditsTextShadowColor}
                onChange={(e) => setCreditsTextShadowColor(String(e.target.value || '').toLowerCase())}
                className="h-10 w-14 rounded-lg border border-white/20 dark:border-white/10 bg-transparent"
              />
              <div className="text-xs text-gray-600 dark:text-gray-300 font-mono">{creditsTextShadowColor}</div>
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">
              {t('admin.creditsTextStrokeWidth', { defaultValue: 'Обводка текста (px)' })}
            </label>
            <input
              type="number"
              min={0}
              max={6}
              step={0.25}
              value={creditsTextStrokeWidth}
              onChange={(e) => setCreditsTextStrokeWidth(Number(e.target.value) || 0)}
              className="w-full px-3 py-2 rounded-lg bg-white/60 dark:bg-white/10 border border-white/20 dark:border-white/10 text-gray-900 dark:text-white"
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">
              {t('admin.creditsTextStrokeOpacity', { defaultValue: 'Обводка текста (opacity)' })}:{' '}
              {Math.round(creditsTextStrokeOpacity * 100)}%
            </label>
            <input
              type="range"
              min={0}
              max={1}
              step={0.02}
              value={creditsTextStrokeOpacity}
              onChange={(e) => setCreditsTextStrokeOpacity(parseFloat(e.target.value))}
              className="w-full"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">
              {t('admin.creditsTextStrokeColor', { defaultValue: 'Обводка текста (color)' })}
            </label>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={creditsTextStrokeColor}
                onChange={(e) => setCreditsTextStrokeColor(String(e.target.value || '').toLowerCase())}
                className="h-10 w-14 rounded-lg border border-white/20 dark:border-white/10 bg-transparent"
              />
              <div className="text-xs text-gray-600 dark:text-gray-300 font-mono">{creditsTextStrokeColor}</div>
            </div>
          </div>
        </div>
      </div>
      <div className="space-y-3">
        <label className="flex items-center gap-2 text-sm text-gray-800 dark:text-gray-100">
          <input
            type="checkbox"
            checked={creditsTitleEnabled}
            onChange={(e) => setCreditsTitleEnabled(e.target.checked)}
            className="h-4 w-4 rounded border-white/20 dark:border-white/10 bg-white/60 dark:bg-white/10"
          />
          {t('admin.creditsTitleEnabled', { defaultValue: 'Заголовки секций' })}
        </label>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">
              {t('admin.creditsTitleSize', { defaultValue: 'Размер заголовка' })}
            </label>
            <input
              type="number"
              min={10}
              max={64}
              value={creditsTitleSize}
              onChange={(e) => setCreditsTitleSize(Number(e.target.value) || 10)}
              className="w-full px-3 py-2 rounded-lg bg-white/60 dark:bg-white/10 border border-white/20 dark:border-white/10 text-gray-900 dark:text-white"
              disabled={!creditsTitleEnabled}
            />
          </div>
          <div>
            <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">
              {t('admin.creditsTitleTransform', { defaultValue: 'Регистр' })}
            </label>
            <select
              value={creditsTitleTransform}
              onChange={(e) => setCreditsTitleTransform(e.target.value as CreditsTitleTransform)}
              className="w-full px-3 py-2 rounded-lg bg-white/60 dark:bg-white/10 border border-white/20 dark:border-white/10 text-gray-900 dark:text-white"
              disabled={!creditsTitleEnabled}
            >
              <option value="none">{t('admin.none', { defaultValue: 'None' })}</option>
              <option value="uppercase">{t('admin.uppercase', { defaultValue: 'UPPERCASE' })}</option>
              <option value="lowercase">{t('admin.lowercase', { defaultValue: 'lowercase' })}</option>
            </select>
          </div>
        </div>
        <div>
          <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">
            {t('admin.creditsTitleColor', { defaultValue: 'Цвет заголовка' })}
          </label>
          <div className="flex items-center gap-3">
            <input
              type="color"
              value={creditsTitleColor}
              onChange={(e) => setCreditsTitleColor(String(e.target.value || '').toLowerCase())}
              className="h-10 w-14 rounded-lg border border-white/20 dark:border-white/10 bg-transparent"
              disabled={!creditsTitleEnabled}
            />
            <div className="text-xs text-gray-600 dark:text-gray-300 font-mono">{creditsTitleColor}</div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">
              {t('admin.creditsTitleShadow', { defaultValue: 'Тень заголовка (blur)' })}
            </label>
            <input
              type="number"
              min={0}
              max={120}
              step={1}
              value={creditsTitleShadowBlur}
              onChange={(e) => setCreditsTitleShadowBlur(Number(e.target.value) || 0)}
              className="w-full px-3 py-2 rounded-lg bg-white/60 dark:bg-white/10 border border-white/20 dark:border-white/10 text-gray-900 dark:text-white"
              disabled={!creditsTitleEnabled}
            />
          </div>
          <div>
            <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">
              {t('admin.creditsTitleShadowOpacity', { defaultValue: 'Тень заголовка (opacity)' })}:{' '}
              {Math.round(creditsTitleShadowOpacity * 100)}%
            </label>
            <input
              type="range"
              min={0}
              max={1}
              step={0.02}
              value={creditsTitleShadowOpacity}
              onChange={(e) => setCreditsTitleShadowOpacity(parseFloat(e.target.value))}
              className="w-full"
              disabled={!creditsTitleEnabled}
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">
              {t('admin.creditsTitleShadowColor', { defaultValue: 'Тень заголовка (color)' })}
            </label>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={creditsTitleShadowColor}
                onChange={(e) => setCreditsTitleShadowColor(String(e.target.value || '').toLowerCase())}
                className="h-10 w-14 rounded-lg border border-white/20 dark:border-white/10 bg-transparent"
                disabled={!creditsTitleEnabled}
              />
              <div className="text-xs text-gray-600 dark:text-gray-300 font-mono">{creditsTitleShadowColor}</div>
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">
              {t('admin.creditsTitleStrokeWidth', { defaultValue: 'Обводка заголовка (px)' })}
            </label>
            <input
              type="number"
              min={0}
              max={6}
              step={0.25}
              value={creditsTitleStrokeWidth}
              onChange={(e) => setCreditsTitleStrokeWidth(Number(e.target.value) || 0)}
              className="w-full px-3 py-2 rounded-lg bg-white/60 dark:bg-white/10 border border-white/20 dark:border-white/10 text-gray-900 dark:text-white"
              disabled={!creditsTitleEnabled}
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">
              {t('admin.creditsTitleStrokeOpacity', { defaultValue: 'Обводка заголовка (opacity)' })}:{' '}
              {Math.round(creditsTitleStrokeOpacity * 100)}%
            </label>
            <input
              type="range"
              min={0}
              max={1}
              step={0.02}
              value={creditsTitleStrokeOpacity}
              onChange={(e) => setCreditsTitleStrokeOpacity(parseFloat(e.target.value))}
              className="w-full"
              disabled={!creditsTitleEnabled}
            />
          </div>
          <div>
            <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">
              {t('admin.creditsTitleStrokeColor', { defaultValue: 'Обводка заголовка (color)' })}
            </label>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={creditsTitleStrokeColor}
                onChange={(e) => setCreditsTitleStrokeColor(String(e.target.value || '').toLowerCase())}
                className="h-10 w-14 rounded-lg border border-white/20 dark:border-white/10 bg-transparent"
                disabled={!creditsTitleEnabled}
              />
              <div className="text-xs text-gray-600 dark:text-gray-300 font-mono">{creditsTitleStrokeColor}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
