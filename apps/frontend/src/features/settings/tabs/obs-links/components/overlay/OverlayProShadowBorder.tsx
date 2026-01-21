import { useTranslation } from 'react-i18next';

import type { ObsLinkFormState } from '../../hooks/useObsLinkForm';
import type { BorderMode, BorderPreset } from '../../types';

type OverlayProShadowBorderProps = {
  overlayForm: ObsLinkFormState;
};

export function OverlayProShadowBorder({ overlayForm }: OverlayProShadowBorderProps) {
  const { t } = useTranslation();
  const {
    advancedTab,
    shadowBlur,
    setShadowBlur,
    shadowAngle,
    setShadowAngle,
    shadowDistance,
    setShadowDistance,
    shadowOpacity,
    setShadowOpacity,
    shadowColor,
    setShadowColor,
    shadowSpread,
    setShadowSpread,
    urlRadius,
    setUrlRadius,
    urlBorder,
    setUrlBorder,
    borderPreset,
    setBorderPreset,
    borderTintColor,
    setBorderTintColor,
    borderTintStrength,
    setBorderTintStrength,
    borderMode,
    setBorderMode,
    urlBorderColor,
    setUrlBorderColor,
    urlBorderColor2,
    setUrlBorderColor2,
    urlBorderGradientAngle,
    setUrlBorderGradientAngle,

  } = overlayForm;

  return (
    <>
            <div className={advancedTab === 'shadow' ? '' : 'hidden'}>
    <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
      {t('admin.obsOverlayShadow', { defaultValue: 'Shadow' })}: <span className="font-mono">{shadowBlur}</span>
    </label>
    <input
      type="range"
      min={0}
      max={200}
      step={2}
      value={shadowBlur}
      onChange={(e) => setShadowBlur(parseInt(e.target.value, 10))}
      className="w-full"
    />
            </div>

            <div className={advancedTab === 'shadow' ? '' : 'hidden'}>
    <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
      {t('admin.obsOverlayShadowAngle', { defaultValue: 'Shadow direction' })}:{' '}
      <span className="font-mono">{Math.round(shadowAngle)}В°</span>
    </label>
    <input
      type="range"
      min={0}
      max={360}
      step={1}
      value={shadowAngle}
      onChange={(e) => setShadowAngle(parseInt(e.target.value, 10))}
      className="w-full"
    />
            </div>

            <div className={advancedTab === 'shadow' ? '' : 'hidden'}>
    <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
      {t('admin.obsOverlayShadowDistance', { defaultValue: 'Shadow distance' })}:{' '}
      <span className="font-mono">{shadowDistance}px</span>
    </label>
    <input
      type="range"
      min={0}
      max={120}
      step={1}
      value={shadowDistance}
      onChange={(e) => setShadowDistance(parseInt(e.target.value, 10))}
      className="w-full"
    />
            </div>

            <div className={advancedTab === 'shadow' ? '' : 'hidden'}>
    <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
      {t('admin.obsOverlayShadowSpread', { defaultValue: 'Shadow spread' })}:{' '}
      <span className="font-mono">{shadowSpread}px</span>
    </label>
    <input
      type="range"
      min={0}
      max={120}
      step={1}
      value={shadowSpread}
      onChange={(e) => setShadowSpread(parseInt(e.target.value, 10))}
      className="w-full"
    />
            </div>

            <div className={advancedTab === 'shadow' ? '' : 'hidden'}>
    <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
      {t('admin.obsOverlayShadowOpacity', { defaultValue: 'Shadow opacity' })}:{' '}
      <span className="font-mono">{Math.round(shadowOpacity * 100)}%</span>
    </label>
    <input
      type="range"
      min={0}
      max={1}
      step={0.02}
      value={shadowOpacity}
      onChange={(e) => setShadowOpacity(parseFloat(e.target.value))}
      className="w-full"
    />
            </div>

            <div className={advancedTab === 'shadow' ? '' : 'hidden'}>
    <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
      {t('admin.obsOverlayShadowColor', { defaultValue: 'Shadow color' })}
    </label>
    <div className="flex items-center gap-3">
      <input
        type="color"
        value={shadowColor}
        onChange={(e) => setShadowColor(String(e.target.value || '').toLowerCase())}
        className="h-10 w-14 rounded-lg border border-white/20 dark:border-white/10 bg-transparent"
        aria-label={t('admin.obsOverlayShadowColor', { defaultValue: 'Shadow color' })}
      />
      <div className="text-xs text-gray-600 dark:text-gray-300 font-mono">{shadowColor}</div>
    </div>
            </div>

            <div className={advancedTab === 'border' ? '' : 'hidden'}>
    <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
      {t('admin.obsOverlayBorderPreset', { defaultValue: 'Frame style' })}
    </label>
    <select
      value={borderPreset}
      onChange={(e) => setBorderPreset(e.target.value as BorderPreset)}
      className="w-full rounded-lg px-3 py-2 bg-white/60 dark:bg-white/10 text-gray-900 dark:text-white shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
    >
      <option value="custom">{t('admin.obsOverlayBorderPresetCustom', { defaultValue: 'Custom' })}</option>
      <option value="glass">{t('admin.obsOverlayBorderPresetGlass', { defaultValue: 'Glass frame' })}</option>
      <option value="glow">{t('admin.obsOverlayBorderPresetGlow', { defaultValue: 'Glow' })}</option>
      <option value="frosted">{t('admin.obsOverlayBorderPresetFrosted', { defaultValue: 'Frosted edge' })}</option>
    </select>
    <div className="text-xs text-gray-600 dark:text-gray-300 mt-1">
      {t('admin.obsOverlayBorderPresetHint', { defaultValue: 'Presets override the visual style of the frame (still uses your thickness/radius).' })}
    </div>
            </div>

            <div className={advancedTab === 'border' ? '' : 'hidden'}>
    {borderPreset !== 'custom' && (
      <div className="glass p-3 mb-3">
        <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">
          {t('admin.obsOverlayBorderPresetControls', { defaultValue: 'Preset controls' })}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
              {t('admin.obsOverlayBorderTintColor', { defaultValue: 'Tint color' })}
            </label>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={borderTintColor}
                onChange={(e) => setBorderTintColor(String(e.target.value || '').toLowerCase())}
                className="h-10 w-14 rounded-lg border border-white/20 dark:border-white/10 bg-transparent"
              />
              <div className="text-xs text-gray-600 dark:text-gray-300 font-mono">{borderTintColor}</div>
            </div>
          </div>
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
              {t('admin.obsOverlayBorderTintStrength', { defaultValue: 'Tint strength' })}:{' '}
              <span className="font-mono">{Math.round(borderTintStrength * 100)}%</span>
            </label>
            <input
              type="range"
              min={0}
              max={1}
              step={0.02}
              value={borderTintStrength}
              onChange={(e) => setBorderTintStrength(parseFloat(e.target.value))}
              className="w-full"
            />
          </div>
        </div>
      </div>
    )}
    <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
      {t('admin.obsOverlayBorder', { defaultValue: 'Border' })}: <span className="font-mono">{urlBorder}px</span>
    </label>
    <input
      type="range"
      min={0}
      max={12}
      step={1}
      value={urlBorder}
      onChange={(e) => setUrlBorder(parseInt(e.target.value, 10))}
      className="w-full"
    />
            </div>

            <div className={advancedTab === 'border' ? '' : 'hidden'}>
    <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
      {t('admin.obsOverlayRadius', { defaultValue: 'Corner radius' })}: <span className="font-mono">{urlRadius}</span>
    </label>
    <input
      type="range"
      min={0}
      max={80}
      step={1}
      value={urlRadius}
      onChange={(e) => setUrlRadius(parseInt(e.target.value, 10))}
      className="w-full"
    />
            </div>

            <div className={advancedTab === 'border' ? '' : 'hidden'}>
    <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
      {t('admin.obsOverlayBorderColor', { defaultValue: 'Border color' })}
    </label>
    <div className="flex items-center justify-between gap-3">
      <select
        value={borderMode}
        onChange={(e) => setBorderMode(e.target.value as BorderMode)}
        disabled={borderPreset !== 'custom'}
        className="rounded-lg px-3 py-2 bg-white/60 dark:bg-white/10 text-gray-900 dark:text-white shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-50"
        aria-label={t('admin.obsOverlayBorderMode', { defaultValue: 'Border mode' })}
      >
        <option value="solid">{t('admin.obsOverlayBorderModeSolid', { defaultValue: 'Solid' })}</option>
        <option value="gradient">{t('admin.obsOverlayBorderModeGradient', { defaultValue: 'Gradient' })}</option>
      </select>
      <input
        type="color"
        value={urlBorderColor}
        onChange={(e) => setUrlBorderColor(String(e.target.value || '').toLowerCase())}
        disabled={borderPreset !== 'custom'}
        className="h-10 w-14 rounded-lg border border-white/20 dark:border-white/10 bg-transparent disabled:opacity-50"
        aria-label={t('admin.obsOverlayBorderColor', { defaultValue: 'Border color' })}
      />
      <div className="text-xs text-gray-600 dark:text-gray-300 font-mono">{urlBorderColor}</div>
    </div>
            </div>

            {borderPreset === 'custom' && borderMode === 'gradient' && (
    <div className={`md:col-span-2 ${advancedTab === 'border' ? '' : 'hidden'}`}>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
            {t('admin.obsOverlayBorderColor2', { defaultValue: 'Gradient color 2' })}
          </label>
          <input
            type="color"
            value={urlBorderColor2}
            onChange={(e) => setUrlBorderColor2(String(e.target.value || '').toLowerCase())}
            className="h-10 w-14 rounded-lg border border-white/20 dark:border-white/10 bg-transparent"
            aria-label={t('admin.obsOverlayBorderColor2', { defaultValue: 'Gradient color 2' })}
          />
          <div className="text-xs text-gray-600 dark:text-gray-300 font-mono mt-1">{urlBorderColor2}</div>
        </div>
        <div className="md:col-span-2">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
            {t('admin.obsOverlayBorderGradientAngle', { defaultValue: 'Gradient angle' })}:{' '}
            <span className="font-mono">{Math.round(urlBorderGradientAngle)}В°</span>
          </label>
          <input
            type="range"
            min={0}
            max={360}
            step={1}
            value={urlBorderGradientAngle}
            onChange={(e) => setUrlBorderGradientAngle(parseInt(e.target.value, 10))}
            className="w-full"
          />
        </div>
      </div>
    </div>
            )}
    </>
  );
}
