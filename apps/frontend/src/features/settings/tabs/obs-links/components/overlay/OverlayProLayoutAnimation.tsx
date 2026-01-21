import { useTranslation } from 'react-i18next';

import type { ObsLinkFormState } from '../../hooks/useObsLinkForm';
import type { OverlayPreviewState } from '../../hooks/useOverlayPreview';
import type { AnimEasingPreset, ScaleMode, UrlAnim, UrlPosition } from '../../types';


type OverlayProLayoutAnimationProps = {
  overlayForm: ObsLinkFormState;
  preview: OverlayPreviewState;
};

export function OverlayProLayoutAnimation({ overlayForm, preview }: OverlayProLayoutAnimationProps) {
  const { t } = useTranslation();
  const {
    advancedTab,
    urlPosition,
    setUrlPosition,
    urlVolume,
    setUrlVolume,
    scaleMode,
    setScaleMode,
    scaleFixed,
    setScaleFixed,
    scaleMin,
    setScaleMin,
    scaleMax,
    setScaleMax,
    safePad,
    setSafePad,
    urlAnim,
    setUrlAnim,
    animEasingPreset,
    setAnimEasingPreset,
    animEasingX1,
    setAnimEasingX1,
    animEasingY1,
    setAnimEasingY1,
    animEasingX2,
    setAnimEasingX2,
    animEasingY2,
    setAnimEasingY2,
    urlEnterMs,
    setUrlEnterMs,
    setUrlExitMs,
  } = overlayForm;
  const { setPreviewLockPositions, flashSafeGuide } = preview;

  const animSpeedPct = Math.max(0, Math.min(100, Math.round(((800 - Math.max(0, Math.min(1200, urlEnterMs))) / (800 - 180)) * 100)));
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
    <>
            <div className={advancedTab === 'layout' ? '' : 'hidden'}>
    <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
      {t('admin.obsOverlayPosition', { defaultValue: 'РџРѕР·РёС†РёСЏ' })}
    </label>
    <select
      value={urlPosition}
      onChange={(e) => setUrlPosition(e.target.value as UrlPosition)}
      className="w-full rounded-lg px-3 py-2 bg-white/60 dark:bg-white/10 text-gray-900 dark:text-white shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
    >
      <option value="random">{t('admin.obsOverlayPositionRandom')}</option>
      <option value="center">{t('admin.obsOverlayPositionCenter')}</option>
      <option value="top">{t('admin.obsOverlayPositionTop')}</option>
      <option value="bottom">{t('admin.obsOverlayPositionBottom')}</option>
      <option value="top-left">{t('admin.obsOverlayPositionTopLeft')}</option>
      <option value="top-right">{t('admin.obsOverlayPositionTopRight')}</option>
      <option value="bottom-left">{t('admin.obsOverlayPositionBottomLeft')}</option>
      <option value="bottom-right">{t('admin.obsOverlayPositionBottomRight')}</option>
    </select>
            </div>

            <div className={advancedTab === 'layout' ? '' : 'hidden'}>
    <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
      {t('admin.obsOverlaySafeArea', { defaultValue: 'Safe area (px)' })}:{' '}
      <span className="font-mono">{safePad}</span>
    </label>
    <input
      type="range"
      min={0}
      max={240}
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

            <div className={`md:col-span-2 ${advancedTab === 'layout' ? '' : 'hidden'}`}>
    <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-2">
      {t('admin.obsOverlayScaleMode', { defaultValue: 'Size' })}
    </label>
    <div className="flex items-center gap-3">
      <select
        value={scaleMode}
        onChange={(e) => setScaleMode(e.target.value as ScaleMode)}
        className="rounded-lg px-3 py-2 bg-white/60 dark:bg-white/10 text-gray-900 dark:text-white shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
      >
        <option value="fixed">{t('admin.obsOverlayScaleFixed', { defaultValue: 'Fixed' })}</option>
        <option value="range">{t('admin.obsOverlayScaleRange', { defaultValue: 'Range' })}</option>
      </select>

      {scaleMode === 'fixed' ? (
        <div className="flex-1">
          <div className="text-xs text-gray-600 dark:text-gray-300 mb-1">
            {t('admin.obsOverlayScaleFixedValue', { defaultValue: 'Scale' })}:{' '}
            <span className="font-mono">{scaleFixed.toFixed(2)}</span>
          </div>
          <input
            type="range"
            min={0.25}
            max={2.5}
            step={0.05}
            value={scaleFixed}
            onChange={(e) => setScaleFixed(parseFloat(e.target.value))}
            onPointerDown={() => setPreviewLockPositions(true)}
            onPointerUp={() => setPreviewLockPositions(false)}
            className="w-full"
          />
        </div>
      ) : (
        <div className="flex-1 grid grid-cols-2 gap-3">
          <div>
            <div className="text-xs text-gray-600 dark:text-gray-300 mb-1">
              {t('admin.obsOverlayScaleMin', { defaultValue: 'Min' })}:{' '}
              <span className="font-mono">{scaleMin.toFixed(2)}</span>
            </div>
            <input
              type="range"
              min={0.25}
              max={2.5}
              step={0.05}
              value={scaleMin}
              onChange={(e) => setScaleMin(parseFloat(e.target.value))}
              className="w-full"
            />
          </div>
          <div>
            <div className="text-xs text-gray-600 dark:text-gray-300 mb-1">
              {t('admin.obsOverlayScaleMax', { defaultValue: 'Max' })}:{' '}
              <span className="font-mono">{scaleMax.toFixed(2)}</span>
            </div>
            <input
              type="range"
              min={0.25}
              max={2.5}
              step={0.05}
              value={scaleMax}
              onChange={(e) => setScaleMax(parseFloat(e.target.value))}
              className="w-full"
            />
          </div>
        </div>
      )}
    </div>
            </div>

            <div className={advancedTab === 'layout' ? '' : 'hidden'}>
    <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
      {t('admin.obsOverlayVolume', { defaultValue: 'Volume' })}: <span className="font-mono">{Math.round(urlVolume * 100)}%</span>
    </label>
    <input
      type="range"
      min={0}
      max={1}
      step={0.05}
      value={urlVolume}
      onChange={(e) => setUrlVolume(parseFloat(e.target.value))}
      className="w-full"
    />
            </div>

            <div className={advancedTab === 'animation' ? '' : 'hidden'}>
    <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
      {t('admin.obsOverlayAnim', { defaultValue: 'Animation' })}
    </label>
    <select
      value={urlAnim}
      onChange={(e) => setUrlAnim(e.target.value as UrlAnim)}
      className="w-full rounded-lg px-3 py-2 bg-white/60 dark:bg-white/10 text-gray-900 dark:text-white shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
    >
      <option value="fade">{t('admin.obsOverlayAnimFade', { defaultValue: 'Fade' })}</option>
      <option value="zoom">{t('admin.obsOverlayAnimZoom', { defaultValue: 'Zoom' })}</option>
      <option value="slide-up">{t('admin.obsOverlayAnimSlideUp', { defaultValue: 'Slide up' })}</option>
      <option value="pop">{t('admin.obsOverlayAnimPop', { defaultValue: 'Pop (premium)' })}</option>
      <option value="lift">{t('admin.obsOverlayAnimLift', { defaultValue: 'Lift (premium)' })}</option>
      <option value="none">{t('admin.obsOverlayAnimNone', { defaultValue: 'None' })}</option>
    </select>
            </div>

            <div className={advancedTab === 'animation' ? '' : 'hidden'}>
    <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
      {t('admin.obsOverlayAnimEasing', { defaultValue: 'Easing' })}
    </label>
    <select
      value={animEasingPreset}
      onChange={(e) => setAnimEasingPreset(e.target.value as AnimEasingPreset)}
      className="w-full rounded-lg px-3 py-2 bg-white/60 dark:bg-white/10 text-gray-900 dark:text-white shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
    >
      <option value="ios">{t('admin.obsOverlayAnimEasingIos', { defaultValue: 'iOS' })}</option>
      <option value="smooth">{t('admin.obsOverlayAnimEasingSmooth', { defaultValue: 'Smooth' })}</option>
      <option value="snappy">{t('admin.obsOverlayAnimEasingSnappy', { defaultValue: 'Snappy' })}</option>
      <option value="linear">{t('admin.obsOverlayAnimEasingLinear', { defaultValue: 'Linear' })}</option>
      <option value="custom">{t('admin.obsOverlayAnimEasingCustom', { defaultValue: 'Custom cubic-bezier' })}</option>
    </select>
    <div className="text-xs text-gray-600 dark:text-gray-300 mt-1">
      {t('admin.obsOverlayAnimEasingHint', { defaultValue: 'Controls the feel of enter/exit. iOS is the recommended default.' })}
    </div>
            </div>

            {animEasingPreset === 'custom' && (
    <div className={`md:col-span-2 ${advancedTab === 'animation' ? '' : 'hidden'}`}>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">x1</label>
          <input
            type="number"
            value={animEasingX1}
            step={0.01}
            min={-1}
            max={2}
            onChange={(e) => setAnimEasingX1(parseFloat(e.target.value))}
            className="w-full rounded-lg px-3 py-2 bg-white/60 dark:bg-white/10 text-gray-900 dark:text-white shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">y1</label>
          <input
            type="number"
            value={animEasingY1}
            step={0.01}
            min={-1}
            max={2}
            onChange={(e) => setAnimEasingY1(parseFloat(e.target.value))}
            className="w-full rounded-lg px-3 py-2 bg-white/60 dark:bg-white/10 text-gray-900 dark:text-white shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">x2</label>
          <input
            type="number"
            value={animEasingX2}
            step={0.01}
            min={-1}
            max={2}
            onChange={(e) => setAnimEasingX2(parseFloat(e.target.value))}
            className="w-full rounded-lg px-3 py-2 bg-white/60 dark:bg-white/10 text-gray-900 dark:text-white shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">y2</label>
          <input
            type="number"
            value={animEasingY2}
            step={0.01}
            min={-1}
            max={2}
            onChange={(e) => setAnimEasingY2(parseFloat(e.target.value))}
            className="w-full rounded-lg px-3 py-2 bg-white/60 dark:bg-white/10 text-gray-900 dark:text-white shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        </div>
      </div>
    </div>
            )}

            <div className={advancedTab === 'animation' ? '' : 'hidden'}>
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

            <div className={`text-xs text-gray-600 dark:text-gray-300 -mt-2 ${advancedTab === 'animation' ? '' : 'hidden'}`}>
    {t('admin.obsOverlayAnimSpeedHint', { defaultValue: 'Slower looks more premium; faster feels snappier.' })}
            </div>
    </>
  );
}
