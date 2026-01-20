import { useTranslation } from 'react-i18next';

import type { GlassPreset, SenderFontFamily, SenderStroke } from '../../types';
import { isSenderFontFamily } from '../../types';
import type { ObsLinkFormState } from '../../hooks/useObsLinkForm';



type OverlayProGlassSenderProps = {
  overlayForm: ObsLinkFormState;
};

export function OverlayProGlassSender({ overlayForm }: OverlayProGlassSenderProps) {
  const { t } = useTranslation();
  const {
    advancedTab,
    glassEnabled,
    setGlassEnabled,
    glassPreset,
    setGlassPreset,
    glassTintColor,
    setGlassTintColor,
    glassTintStrength,
    setGlassTintStrength,
    urlBlur,
    setUrlBlur,
    urlBgOpacity,
    setUrlBgOpacity,
    senderFontSize,
    setSenderFontSize,
    senderFontWeight,
    setSenderFontWeight,
    senderFontFamily,
    setSenderFontFamily,
    senderFontColor,
    setSenderFontColor,
    senderHoldMs,
    setSenderHoldMs,
    senderBgColor,
    setSenderBgColor,
    senderBgOpacity,
    setSenderBgOpacity,
    senderBgRadius,
    setSenderBgRadius,
    senderStroke,
    setSenderStroke,
    senderStrokeWidth,
    setSenderStrokeWidth,
    senderStrokeOpacity,
    setSenderStrokeOpacity,
    senderStrokeColor,
    setSenderStrokeColor,

  } = overlayForm;

  return (
    <>
            <div className={advancedTab === 'glass' ? '' : 'hidden'}>
    <div className="flex items-center justify-between gap-3 mb-2">
      <label className="text-sm font-medium text-gray-700 dark:text-gray-200">
        {t('admin.obsOverlayGlassEnabled', { defaultValue: 'Glass' })}
      </label>
      <button
        type="button"
        onClick={() => setGlassEnabled((v) => !v)}
        className={`glass-btn px-3 py-1.5 text-sm font-semibold ${glassEnabled ? 'ring-2 ring-primary/40' : 'opacity-70'}`}
      >
        {glassEnabled ? t('common.on', { defaultValue: 'On' }) : t('common.off', { defaultValue: 'Off' })}
      </button>
    </div>

    <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
      {t('admin.obsOverlayGlassStyle', { defaultValue: 'Glass style' })}
    </label>
    <select
      value={glassPreset}
      onChange={(e) => setGlassPreset(e.target.value as GlassPreset)}
      disabled={!glassEnabled}
      className="w-full rounded-lg px-3 py-2 bg-white/60 dark:bg-white/10 text-gray-900 dark:text-white shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-50"
    >
      <option value="ios">{t('admin.obsOverlayGlassPresetIos', { defaultValue: 'iOS (shine)' })}</option>
      <option value="clear">{t('admin.obsOverlayGlassPresetClear', { defaultValue: 'Clear' })}</option>
      <option value="prism">{t('admin.obsOverlayGlassPresetPrism', { defaultValue: 'Prism' })}</option>
    </select>
            </div>

            <div className={advancedTab === 'glass' ? '' : 'hidden'}>
    <div className="glass p-3">
      <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">
        {t('admin.obsOverlayGlassPresetControls', { defaultValue: 'Preset controls' })}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
            {t('admin.obsOverlayGlassTintColor', { defaultValue: 'Tint color' })}
          </label>
          <div className="flex items-center gap-3">
            <input
              type="color"
              value={glassTintColor}
              onChange={(e) => setGlassTintColor(String(e.target.value || '').toLowerCase())}
              disabled={!glassEnabled}
              className="h-10 w-14 rounded-lg border border-white/20 dark:border-white/10 bg-transparent disabled:opacity-50"
            />
            <div className="text-xs text-gray-600 dark:text-gray-300 font-mono">{glassTintColor}</div>
          </div>
        </div>
        <div className="md:col-span-2">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
            {t('admin.obsOverlayGlassTintStrength', { defaultValue: 'Tint strength' })}:{' '}
            <span className="font-mono">{Math.round(glassTintStrength * 100)}%</span>
          </label>
          <input
            type="range"
            min={0}
            max={1}
            step={0.02}
            value={glassTintStrength}
            onChange={(e) => setGlassTintStrength(parseFloat(e.target.value))}
            disabled={!glassEnabled}
            className="w-full disabled:opacity-50"
          />
        </div>
      </div>
    </div>
            </div>

            <div className={advancedTab === 'glass' ? '' : 'hidden'}>
    <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
      {t('admin.obsOverlayBlur', { defaultValue: 'Glass blur' })}: <span className="font-mono">{urlBlur}px</span>
    </label>
    <input
      type="range"
      min={0}
      max={40}
      step={1}
      value={urlBlur}
      onChange={(e) => setUrlBlur(parseInt(e.target.value, 10))}
      disabled={!glassEnabled}
      className="w-full disabled:opacity-50"
    />
            </div>

            <div className={advancedTab === 'glass' ? '' : 'hidden'}>
    <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
      {t('admin.obsOverlayBgOpacity', { defaultValue: 'Glass opacity' })}:{' '}
      <span className="font-mono">{Math.round(urlBgOpacity * 100)}%</span>
    </label>
    <input
      type="range"
      min={0}
      max={0.65}
      step={0.01}
      value={urlBgOpacity}
      onChange={(e) => setUrlBgOpacity(parseFloat(e.target.value))}
      disabled={!glassEnabled}
      className="w-full disabled:opacity-50"
    />
            </div>

            {overlayShowSender && (
            <div className={`md:col-span-2 ${advancedTab === 'sender' ? '' : 'hidden'}`}>
    <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">
      {t('admin.obsOverlaySenderTypography', { defaultValue: 'Sender label' })}
    </div>
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      <div className="md:col-span-3">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
          {t('admin.obsOverlaySenderHold', { defaultValue: 'Show duration' })}:{' '}
          <span className="font-mono">{Math.round(senderHoldMs / 100) / 10}s</span>
        </label>
        <input
          type="range"
          min={0}
          max={8000}
          step={100}
          value={senderHoldMs}
          onChange={(e) => setSenderHoldMs(parseInt(e.target.value, 10))}
          className="w-full"
        />
        <div className="text-xs text-gray-600 dark:text-gray-300 mt-1">
          {t('admin.obsOverlaySenderHoldHint', { defaultValue: '0s = stay visible the whole meme.' })}
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
          {t('admin.obsOverlaySenderFontSize', { defaultValue: 'Font size' })}:{' '}
          <span className="font-mono">{senderFontSize}px</span>
        </label>
        <input
          type="range"
          min={10}
          max={28}
          step={1}
          value={senderFontSize}
          onChange={(e) => setSenderFontSize(parseInt(e.target.value, 10))}
          className="w-full"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
          {t('admin.obsOverlaySenderFontWeight', { defaultValue: 'Weight' })}
        </label>
        <select
          value={senderFontWeight}
          onChange={(e) => setSenderFontWeight(parseInt(e.target.value, 10))}
          className="w-full rounded-lg px-3 py-2 bg-white/60 dark:bg-white/10 text-gray-900 dark:text-white shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
        >
          <option value={400}>400</option>
          <option value={500}>500</option>
          <option value={600}>600</option>
          <option value={700}>700</option>
          <option value={800}>800</option>
        </select>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
          {t('admin.obsOverlaySenderFontFamily', { defaultValue: 'Font' })}
        </label>
        <select
          value={senderFontFamily}
          onChange={(e) => {
            const v = e.target.value;
            if (isSenderFontFamily(v)) setSenderFontFamily(v);
          }}
          className="w-full rounded-lg px-3 py-2 bg-white/60 dark:bg-white/10 text-gray-900 dark:text-white shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
        >
          <option value="system">{t('admin.obsOverlaySenderFontSystem', { defaultValue: 'System' })}</option>
          <option value="inter">Inter</option>
          <option value="roboto">Roboto</option>
          <option value="montserrat">Montserrat</option>
          <option value="poppins">Poppins</option>
          <option value="raleway">Raleway</option>
          <option value="nunito">Nunito</option>
          <option value="oswald">Oswald</option>
          <option value="playfair">Playfair Display</option>
          <option value="jetbrains-mono">JetBrains Mono</option>
          <option value="mono">{t('admin.obsOverlaySenderFontMono', { defaultValue: 'Monospace' })}</option>
          <option value="serif">{t('admin.obsOverlaySenderFontSerif', { defaultValue: 'Serif' })}</option>
        </select>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
          {t('admin.obsOverlaySenderFontColor', { defaultValue: 'Text color' })}
        </label>
        <div className="flex items-center gap-3">
          <input
            type="color"
            value={senderFontColor}
            onChange={(e) => setSenderFontColor(String(e.target.value || '').toLowerCase())}
            className="h-10 w-14 rounded-lg border border-white/20 dark:border-white/10 bg-transparent"
          />
          <div className="text-xs text-gray-600 dark:text-gray-300 font-mono">{senderFontColor}</div>
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
          {t('admin.obsOverlaySenderBgColor', { defaultValue: 'Background color' })}
        </label>
        <div className="flex items-center gap-3">
          <input
            type="color"
            value={senderBgColor}
            onChange={(e) => setSenderBgColor(String(e.target.value || '').toLowerCase())}
            className="h-10 w-14 rounded-lg border border-white/20 dark:border-white/10 bg-transparent"
          />
          <div className="text-xs text-gray-600 dark:text-gray-300 font-mono">{senderBgColor}</div>
        </div>
      </div>
      <div className="md:col-span-2">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
          {t('admin.obsOverlaySenderBgOpacity', { defaultValue: 'Background opacity' })}:{' '}
          <span className="font-mono">{Math.round(senderBgOpacity * 100)}%</span>
        </label>
        <input
          type="range"
          min={0}
          max={1}
          step={0.02}
          value={senderBgOpacity}
          onChange={(e) => setSenderBgOpacity(parseFloat(e.target.value))}
          className="w-full"
        />
      </div>
      <div className="md:col-span-3">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
          {t('admin.obsOverlaySenderBgRadius', { defaultValue: 'Background radius' })}:{' '}
          <span className="font-mono">{senderBgRadius}</span>
        </label>
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={0}
            max={60}
            step={1}
            value={senderBgRadius}
            onChange={(e) => setSenderBgRadius(parseInt(e.target.value, 10))}
            className="w-full"
          />
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="glass-btn shrink-0"
            onClick={() => setSenderBgRadius(999)}
          >
            {t('admin.obsOverlaySenderBgPill', { defaultValue: 'Pill' })}
          </Button>
        </div>
        <div className="text-xs text-gray-600 dark:text-gray-300 mt-1">
          {t('admin.obsOverlaySenderBgRadiusHint', { defaultValue: 'Tip: try 8вЂ“16 for a modern rounded rectangle.' })}
        </div>
      </div>

      <div className="md:col-span-3">
        <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">
          {t('admin.obsOverlaySenderStrokeTitle', { defaultValue: 'Label border' })}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
              {t('admin.obsOverlaySenderStrokeStyle', { defaultValue: 'Style' })}
            </label>
            <select
              value={senderStroke}
              onChange={(e) => setSenderStroke(e.target.value as SenderStroke)}
              className="w-full rounded-lg px-3 py-2 bg-white/60 dark:bg-white/10 text-gray-900 dark:text-white shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              <option value="glass">{t('admin.obsOverlaySenderStrokeGlass', { defaultValue: 'Glass' })}</option>
              <option value="solid">{t('admin.obsOverlaySenderStrokeSolid', { defaultValue: 'Solid' })}</option>
              <option value="none">{t('admin.obsOverlaySenderStrokeNone', { defaultValue: 'None' })}</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
              {t('admin.obsOverlaySenderStrokeWidth', { defaultValue: 'Width' })}:{' '}
              <span className="font-mono">{senderStrokeWidth}px</span>
            </label>
            <input
              type="range"
              min={0}
              max={6}
              step={1}
              value={senderStrokeWidth}
              onChange={(e) => setSenderStrokeWidth(parseInt(e.target.value, 10))}
              className="w-full"
              disabled={senderStroke === 'none'}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
              {t('admin.obsOverlaySenderStrokeOpacity', { defaultValue: 'Opacity' })}:{' '}
              <span className="font-mono">{Math.round(senderStrokeOpacity * 100)}%</span>
            </label>
            <input
              type="range"
              min={0}
              max={1}
              step={0.02}
              value={senderStrokeOpacity}
              onChange={(e) => setSenderStrokeOpacity(parseFloat(e.target.value))}
              className="w-full"
              disabled={senderStroke === 'none'}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
              {t('admin.obsOverlaySenderStrokeColor', { defaultValue: 'Color' })}
            </label>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={senderStrokeColor}
                onChange={(e) => setSenderStrokeColor(String(e.target.value || '').toLowerCase())}
                className="h-10 w-14 rounded-lg border border-white/20 dark:border-white/10 bg-transparent"
                disabled={senderStroke !== 'solid'}
              />
              <div className="text-xs text-gray-600 dark:text-gray-300 font-mono">{senderStrokeColor}</div>
            </div>
            <div className="text-xs text-gray-600 dark:text-gray-300 mt-1">
              {t('admin.obsOverlaySenderStrokeHint', { defaultValue: 'Glass uses automatic highlights; Solid uses your color.' })}
            </div>
          </div>
        </div>
      </div>
    </div>
            </div>
            )}
    </>
    </>
  );
}
