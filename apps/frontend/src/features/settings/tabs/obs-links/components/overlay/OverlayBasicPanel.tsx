import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { ObsLinkFormState } from '../../hooks/useObsLinkForm';
import type { OverlayPreviewState } from '../../hooks/useOverlayPreview';
import type { OverlaySettingsState } from '../../hooks/useOverlaySettings';
import type { AnimEasingPreset, UrlAnim, UrlPosition } from '../../types';

import { Button, HelpTooltip, Input } from '@/shared/ui';


type OverlayBasicPanelProps = {
  overlayForm: ObsLinkFormState;
  overlaySettings: OverlaySettingsState;
  preview: OverlayPreviewState;
};

export function OverlayBasicPanel({ overlayForm, overlaySettings, preview }: OverlayBasicPanelProps) {
  const { t } = useTranslation();
  const {
    overlayMode,
    setOverlayMode,
    overlayShowSender,
    setOverlayShowSender,
    overlayMaxConcurrent,
    setOverlayMaxConcurrent,
    presetName,
    setPresetName,
    customPresets,
    saveCurrentAsCustomPreset,
    deleteCustomPreset,
    applyPreset,
    applySharePayload,
    urlPosition,
    setUrlPosition,
    urlVolume,
    setUrlVolume,
    scaleMode,
    setScaleMode,
    scaleFixed,
    setScaleFixed,
    scaleMin,
    scaleMax,
    safePad,
    setSafePad,
    urlAnim,
    setUrlAnim,
    animEasingPreset,
    setAnimEasingPreset,
    urlEnterMs,
    setUrlEnterMs,
    setUrlExitMs,
    glassEnabled,
    setGlassEnabled,
    performanceMode,
    togglePerformanceMode,
  } = overlayForm;
  const { loadingOverlaySettings, savingOverlaySettings } = overlaySettings;
  const { setPreviewLockPositions, flashSafeGuide } = preview;

  const animSpeedPct = useMemo(() => {
    const slow = 800;
    const fast = 180;
    const v = Math.max(0, Math.min(1200, urlEnterMs));
    const pct = Math.round(((slow - v) / (slow - fast)) * 100);
    return Math.max(0, Math.min(100, pct));
  }, [urlEnterMs]);

  const setAnimSpeedPct = (pct: number) => {
    const slow = 800;
    const fast = 180;
    const p = Math.max(0, Math.min(100, pct));
    const enter = Math.round(slow - (p / 100) * (slow - fast));
    const exit = Math.round(enter * 0.75);
    setUrlEnterMs(enter);
    setUrlExitMs(exit);
  };

  return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="glass p-4 space-y-3">
          <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
            {t('admin.obsPresets', { defaultValue: 'Presets' })}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="secondary" className="glass-btn" onClick={() => applyPreset('default')}>
              {t('admin.obsPresetDefault', { defaultValue: 'Default' })}
            </Button>
            <Button type="button" size="sm" variant="secondary" className="glass-btn" onClick={() => applyPreset('minimal')}>
              {t('admin.obsPresetMinimal', { defaultValue: 'Minimal' })}
            </Button>
            <Button type="button" size="sm" variant="secondary" className="glass-btn" onClick={() => applyPreset('neon')}>
              {t('admin.obsPresetNeon', { defaultValue: 'Neon' })}
            </Button>
          </div>
          <div className="text-xs text-gray-600 dark:text-gray-300">
            {t('admin.obsPresetsHint', { defaultValue: 'Start from a preset, then tweak below.' })}
          </div>

          <div className="pt-2 border-t border-white/15 dark:border-white/10">
            <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">
              {t('admin.obsCustomPresets', { defaultValue: 'Your presets' })}
            </div>
            <div className="flex items-center gap-2">
              <Input
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
                placeholder={t('admin.obsPresetNamePlaceholder', { defaultValue: 'Preset name…' })}
                className="flex-1"
              />
              <Button type="button" size="sm" variant="secondary" className="glass-btn" onClick={saveCurrentAsCustomPreset}>
                {t('admin.obsPresetSave', { defaultValue: 'Save' })}
              </Button>
            </div>

            {customPresets.length > 0 ? (
              <div className="mt-2 space-y-2">
                {customPresets.map((p) => (
                  <div key={p.id} className="flex items-center gap-2">
                    <HelpTooltip content={t('help.settings.obs.presetApply', { defaultValue: 'Apply this saved preset to your overlay settings.' })}>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        className="glass-btn flex-1 justify-start"
                        onClick={() => applySharePayload(p.payload)}
                      >
                        {p.name}
                      </Button>
                    </HelpTooltip>
                    <HelpTooltip content={t('help.settings.obs.presetDelete', { defaultValue: 'Delete this saved preset.' })}>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        className="glass-btn"
                        onClick={() => deleteCustomPreset(p.id)}
                      >
                        {t('common.delete', { defaultValue: 'Delete' })}
                      </Button>
                    </HelpTooltip>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-2 text-xs text-gray-600 dark:text-gray-300">
                {t('admin.obsCustomPresetsEmpty', { defaultValue: 'Save your first preset to reuse it later.' })}
              </div>
            )}
          </div>
        </div>

        <div className="glass p-4 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                {t('admin.obsOverlayPosition', { defaultValue: 'Position' })}
              </label>
              <select
                value={urlPosition}
                onChange={(e) => setUrlPosition(e.target.value as UrlPosition)}
                className="w-full rounded-lg px-3 py-2 bg-white/60 dark:bg-white/10 text-gray-900 dark:text-white shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              >
                <option value="random">{t('admin.obsOverlayPositionRandom', { defaultValue: 'Random' })}</option>
                <option value="center">{t('admin.obsOverlayPositionCenter', { defaultValue: 'Center' })}</option>
                <option value="top">{t('admin.obsOverlayPositionTop', { defaultValue: 'Top' })}</option>
                <option value="bottom">{t('admin.obsOverlayPositionBottom', { defaultValue: 'Bottom' })}</option>
                <option value="top-left">{t('admin.obsOverlayPositionTopLeft', { defaultValue: 'Top-left' })}</option>
                <option value="top-right">{t('admin.obsOverlayPositionTopRight', { defaultValue: 'Top-right' })}</option>
                <option value="bottom-left">{t('admin.obsOverlayPositionBottomLeft', { defaultValue: 'Bottom-left' })}</option>
                <option value="bottom-right">{t('admin.obsOverlayPositionBottomRight', { defaultValue: 'Bottom-right' })}</option>
              </select>
            </div>

            {/* mediaFit removed: always cover to avoid black bars */}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                {t('admin.obsOverlaySize', { defaultValue: 'Size' })}:{' '}
                <span className="font-mono">{Math.round(scaleFixed * 100)}%</span>
              </label>
              <input
                type="range"
                min={0.4}
                max={1.6}
                step={0.05}
                value={scaleMode === 'fixed' ? scaleFixed : Math.min(1.6, Math.max(0.4, (scaleMin + scaleMax) / 2))}
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  setScaleMode('fixed');
                  setScaleFixed(v);
                }}
                onPointerDown={() => setPreviewLockPositions(true)}
                onPointerUp={() => setPreviewLockPositions(false)}
                className="w-full"
              />
              <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                {t('admin.obsOverlaySizeHint', { defaultValue: 'Controls the overall meme size.' })}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                {t('admin.obsOverlaySafeArea', { defaultValue: 'Safe area (px)' })}:{' '}
                <span className="font-mono">{safePad}</span>
              </label>
              <input
                type="range"
                min={0}
                max={160}
                step={4}
                value={safePad}
                onChange={(e) => {
                  setSafePad(parseInt(e.target.value, 10));
                  flashSafeGuide();
                }}
                onPointerDown={() => {
                  setPreviewLockPositions(true);
                  flashSafeGuide();
                }}
                onPointerUp={() => setPreviewLockPositions(false)}
                className="w-full"
              />
              <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                {t('admin.obsOverlaySafeAreaHint', { defaultValue: 'Keeps memes away from the edges to avoid clipping.' })}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                {t('admin.obsOverlayMode', { defaultValue: 'Mode' })}
              </label>
              <div className="inline-flex rounded-lg overflow-hidden glass-btn bg-white/40 dark:bg-white/5">
                <button
                  type="button"
                  onClick={() => setOverlayMode('queue')}
                  disabled={loadingOverlaySettings || savingOverlaySettings}
                  className={`px-3 py-2 text-sm font-medium ${
                    overlayMode === 'queue'
                      ? 'bg-primary text-white'
                      : 'bg-transparent text-gray-900 dark:text-white'
                  }`}
                >
                  {t('admin.obsOverlayModeQueueShort', { defaultValue: 'Queue' })}
                </button>
                <button
                  type="button"
                  onClick={() => setOverlayMode('simultaneous')}
                  disabled={loadingOverlaySettings || savingOverlaySettings}
                  className={`px-3 py-2 text-sm font-medium border-l border-white/20 dark:border-white/10 ${
                    overlayMode === 'simultaneous'
                      ? 'bg-primary text-white'
                      : 'bg-transparent text-gray-900 dark:text-white'
                  }`}
                >
                  {t('admin.obsOverlayModeUnlimited', { defaultValue: 'Unlimited' })}
                </button>
              </div>
              <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                {overlayMode === 'queue'
                  ? t('admin.obsOverlayModeQueueHint', { defaultValue: 'Shows one meme at a time.' })
                  : t('admin.obsOverlayModeUnlimitedHint', { defaultValue: 'Shows all incoming memes at once (no limit).' })}
              </div>
            </div>

            <div className="pt-1">
              {overlayMode === 'simultaneous' ? (
                <>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                    {t('admin.obsOverlayMaxConcurrent', { defaultValue: 'Max simultaneous memes' })}:{' '}
                    <span className="font-mono">{overlayMaxConcurrent}</span>
                  </label>
                  <input
                    type="range"
                    min={1}
                    max={5}
                    step={1}
                    value={overlayMaxConcurrent}
                    onChange={(e) => setOverlayMaxConcurrent(parseInt(e.target.value, 10))}
                    className="w-full"
                    disabled={loadingOverlaySettings || savingOverlaySettings}
                  />
                  <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                    {t('admin.obsOverlayMaxConcurrentHint', {
                      defaultValue: 'Safety limit for unlimited mode (prevents OBS from lagging).',
                    })}
                  </div>
                </>
              ) : (
                <div className="flex items-start gap-3 pt-7">
                  <input
                    id="overlayShowSenderBasic"
                    type="checkbox"
                    checked={overlayShowSender}
                    onChange={(e) => setOverlayShowSender(e.target.checked)}
                    className="mt-1 h-4 w-4 rounded border-white/20 dark:border-white/10 bg-white/60 dark:bg-white/10"
                    disabled={loadingOverlaySettings || savingOverlaySettings}
                  />
                  <label htmlFor="overlayShowSenderBasic" className="text-sm text-gray-800 dark:text-gray-100">
                    <div className="font-medium">{t('admin.obsOverlayShowSender', { defaultValue: 'Show sender name' })}</div>
                    <div className="text-xs text-gray-600 dark:text-gray-300">
                      {t('admin.obsOverlayShowSenderHint', { defaultValue: 'Displayed on top of the meme.' })}
                    </div>
                  </label>
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                {t('admin.obsOverlayAnim', { defaultValue: 'Animation' })}
              </label>
              <select
                value={urlAnim}
                onChange={(e) => setUrlAnim(e.target.value as UrlAnim)}
                className="w-full rounded-lg px-3 py-2 bg-white/60 dark:bg-white/10 text-gray-900 dark:text-white shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              >
                <option value="fade">{t('admin.obsOverlayAnimFade', { defaultValue: 'Fade' })}</option>
                <option value="slide-up">{t('admin.obsOverlayAnimSlideUp', { defaultValue: 'Slide up' })}</option>
                <option value="pop">{t('admin.obsOverlayAnimPop', { defaultValue: 'Pop' })}</option>
                <option value="none">{t('admin.obsOverlayAnimNone', { defaultValue: 'None' })}</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                {t('admin.obsOverlayVolume', { defaultValue: 'Volume' })}:{' '}
                <span className="font-mono">{Math.round(urlVolume * 100)}%</span>
              </label>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={urlVolume}
                onChange={(e) => setUrlVolume(parseFloat(e.target.value))}
                className="w-full"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                {t('admin.obsOverlayEasing', { defaultValue: 'Easing' })}
              </label>
              <select
                value={animEasingPreset === 'custom' ? 'ios' : animEasingPreset}
                onChange={(e) => setAnimEasingPreset(e.target.value as AnimEasingPreset)}
                className="w-full rounded-lg px-3 py-2 bg-white/60 dark:bg-white/10 text-gray-900 dark:text-white shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              >
                <option value="ios">{t('admin.obsOverlayEasingIos', { defaultValue: 'iOS (default)' })}</option>
                <option value="smooth">{t('admin.obsOverlayEasingSmooth', { defaultValue: 'Smooth' })}</option>
                <option value="snappy">{t('admin.obsOverlayEasingSnappy', { defaultValue: 'Snappy' })}</option>
                <option value="linear">{t('admin.obsOverlayEasingLinear', { defaultValue: 'Linear' })}</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                {t('admin.obsOverlayAnimSpeed', { defaultValue: 'Animation speed' })}:{' '}
                <span className="font-mono">{animSpeedPct}%</span>
              </label>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={animSpeedPct}
                onChange={(e) => setAnimSpeedPct(parseInt(e.target.value, 10))}
                className="w-full"
              />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <input
              id="glassEnabledBasic"
              type="checkbox"
              checked={glassEnabled}
              onChange={(e) => setGlassEnabled(e.target.checked)}
              className="h-4 w-4 rounded border-white/20 dark:border-white/10 bg-white/60 dark:bg-white/10"
            />
            <label htmlFor="glassEnabledBasic" className="text-sm text-gray-800 dark:text-gray-100">
              <div className="font-medium">{t('admin.obsGlassEnabled', { defaultValue: 'Glass effect' })}</div>
              <div className="text-xs text-gray-600 dark:text-gray-300">
                {t('admin.obsGlassEnabledHint', { defaultValue: 'Can look great, but may cost performance in OBS.' })}
              </div>
            </label>
          </div>

          <div className="flex items-start gap-3 pt-2 border-t border-white/15 dark:border-white/10">
            <input
              id="performanceMode"
              type="checkbox"
              checked={performanceMode}
              onChange={() => togglePerformanceMode()}
              className="mt-1 h-4 w-4 rounded border-white/20 dark:border-white/10 bg-white/60 dark:bg-white/10"
            />
            <label htmlFor="performanceMode" className="text-sm text-gray-800 dark:text-gray-100">
              <div className="font-medium">{t('admin.obsPerformanceMode', { defaultValue: 'Performance mode' })}</div>
              <div className="text-xs text-gray-600 dark:text-gray-300">
                {t('admin.obsPerformanceModeHint', { defaultValue: 'Disables blur/glass and reduces heavy effects to keep OBS smooth.' })}
              </div>
            </label>
          </div>
        </div>
      </div>
  );
}
