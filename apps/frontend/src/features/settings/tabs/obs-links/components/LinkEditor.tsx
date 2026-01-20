import { useTranslation } from 'react-i18next';

import type { ObsLinkFormState } from '../hooks/useObsLinkForm';
import type { OverlayPreviewState } from '../hooks/useOverlayPreview';
import type { OverlaySettingsState } from '../hooks/useOverlaySettings';

import { LinkPreview } from './LinkPreview';
import { OverlayBasicPanel } from './overlay/OverlayBasicPanel';
import { OverlayProPanel } from './overlay/OverlayProPanel';
import { Button, HelpTooltip } from '@/shared/ui';
import { SavedOverlay, SavingOverlay } from '@/shared/ui/StatusOverlays';


type LinkEditorProps = {
  overlayForm: ObsLinkFormState;
  overlaySettings: OverlaySettingsState;
  preview: OverlayPreviewState;
};

export function LinkEditor({ overlayForm, overlaySettings, preview }: LinkEditorProps) {
  const { t } = useTranslation();
  const {
    overlayMode,
    setOverlayMode,
    overlayShowSender,
    setOverlayShowSender,
    overlayMaxConcurrent,
    setOverlayMaxConcurrent,
    advancedTab,
    setAdvancedTab,
    obsUiMode,
    setObsUiMode,
    resetOverlayToDefaults,
  } = overlayForm;


  const {
    overlayToken,
    loadingOverlaySettings,
    savingOverlaySettings,
    overlaySettingsSavedPulse,
    overlaySettingsDirty,
    handleSaveOverlaySettings,
  } = overlaySettings;

  return (
    <>
      <div className="glass p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <input
            id="overlayShowSender"
            type="checkbox"
            checked={overlayShowSender}
            onChange={(e) => {
              setOverlayShowSender(e.target.checked);
            }}
            className="mt-1 h-4 w-4 rounded border-white/20 dark:border-white/10 bg-white/60 dark:bg-white/10"
            disabled={loadingOverlaySettings || savingOverlaySettings}
          />
          <label htmlFor="overlayShowSender" className="text-sm text-gray-800 dark:text-gray-100">
            <div className="font-medium">{t('admin.obsOverlayShowSender', { defaultValue: 'Show sender name' })}</div>
          </label>
        </div>
      </div>

      <details className="glass p-5 sm:p-6">
        <summary className="cursor-pointer font-semibold text-gray-900 dark:text-white flex items-center justify-between gap-3 [-webkit-details-marker]:hidden">
          <span>{t('admin.obsAdvancedOverlayUrl', { defaultValue: 'Advanced overlay URL (customize)' })}</span>
          <svg className="w-4 h-4 text-gray-500 dark:text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </summary>
        <div className="mt-3 space-y-4">
      <div className="text-xs text-gray-600 dark:text-gray-300">
        {t('admin.obsOverlayAdvancedHintShort', {
          defaultValue: 'Change the look here вЂ” then copy the single overlay URL above into OBS.',
        })}
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="inline-flex rounded-xl overflow-hidden border border-white/20 dark:border-white/10">
          <button
            type="button"
            className={`px-3 py-2 text-sm font-semibold ${
              obsUiMode === 'basic'
                ? 'bg-primary text-white'
                : 'bg-white/60 dark:bg-white/10 text-gray-900 dark:text-white'
            }`}
            onClick={() => setObsUiMode('basic')}
          >
            {t('admin.obsUiBasic', { defaultValue: 'Basic' })}
          </button>
          <button
            type="button"
            className={`px-3 py-2 text-sm font-semibold border-l border-white/20 dark:border-white/10 ${
              obsUiMode === 'pro'
                ? 'bg-primary text-white'
                : 'bg-white/60 dark:bg-white/10 text-gray-900 dark:text-white'
            }`}
            onClick={() => setObsUiMode('pro')}
          >
            {t('admin.obsUiPro', { defaultValue: 'Pro' })}
          </button>
        </div>
        <div className="text-xs text-gray-600 dark:text-gray-300">
          {obsUiMode === 'basic'
            ? t('admin.obsUiBasicHint', { defaultValue: 'Simple controls for quick setup.' })
            : t('admin.obsUiProHint', { defaultValue: 'Full control for designers.' })}
        </div>
      </div>

      <div className="relative">
        {(loadingOverlaySettings || savingOverlaySettings) && <SavingOverlay label={t('admin.saving')} />}
        {overlaySettingsSavedPulse && !savingOverlaySettings && !loadingOverlaySettings && <SavedOverlay label={t('admin.saved')} />}

        <div
          className={`space-y-4 transition-opacity ${
            loadingOverlaySettings || savingOverlaySettings ? 'pointer-events-none opacity-60' : ''
          }`}
        >
          <div className="rounded-xl bg-white/50 dark:bg-white/5 ring-1 ring-black/5 dark:ring-white/10 p-4">
            <div
              className={`grid grid-cols-1 md:grid-cols-2 gap-4`}
            >
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
              {t('admin.obsOverlayMode')}
            </label>
            <div className="inline-flex rounded-lg overflow-hidden glass-btn bg-white/40 dark:bg-white/5">
              <button
                type="button"
                onClick={() => {
                  setOverlayMode('queue');
                }}
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
                onClick={() => {
                  setOverlayMode('simultaneous');
                }}
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

          {overlayMode === 'simultaneous' && (
            <div className="pt-1">
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
              />
              <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                {t('admin.obsOverlayMaxConcurrentHint', { defaultValue: 'Safety limit for unlimited mode (prevents OBS from lagging).' })}
              </div>
            </div>
          )}
        </div>
            </div>
          </div>

          <LinkPreview overlayToken={overlayToken} preview={preview} />

          <div className="glass p-3">
            <div className="flex items-center justify-between gap-3">
              {obsUiMode === 'pro' ? (
              <div className="flex-1 overflow-x-auto no-scrollbar">
                <div className="flex items-center gap-2 min-w-max pr-1">
                {(
                  [
                    ['layout', t('admin.obsAdvancedTabLayout', { defaultValue: 'Layout' })],
                    ['animation', t('admin.obsAdvancedTabAnimation', { defaultValue: 'Animation' })],
                    ['shadow', t('admin.obsAdvancedTabShadow', { defaultValue: 'Shadow' })],
                    ['border', t('admin.obsAdvancedTabBorder', { defaultValue: 'Border' })],
                    ['glass', t('admin.obsAdvancedTabGlass', { defaultValue: 'Glass' })],
                    ['sender', t('admin.obsAdvancedTabSender', { defaultValue: 'Sender' })],
                  ] as const
                )
                  .filter(([k]) => (k === 'sender' ? overlayShowSender : true))
                  .map(([k, label]) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setAdvancedTab(k)}
                      className={`h-11 px-4 shrink-0 rounded-xl border text-xs sm:text-sm font-semibold transition-colors ${
                        advancedTab === k
                          ? 'bg-primary text-white border-primary/30 shadow-sm'
                          : 'bg-white/60 dark:bg-white/10 text-gray-900 dark:text-white border-white/30 dark:border-white/10 hover:bg-white/80 dark:hover:bg-white/15'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              ) : (
                <div className="flex-1 text-sm text-gray-700 dark:text-gray-200 font-semibold">
                  {t('admin.obsUiBasicTitle', { defaultValue: 'Quick controls' })}
                </div>
              )}

              <div className="flex items-center gap-2 shrink-0">
                {overlaySettingsDirty && (
                  <div className="hidden sm:flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
                    <span className="inline-block h-2 w-2 rounded-full bg-amber-400" />
                    {t('admin.unsavedChanges', { defaultValue: 'Р•СЃС‚СЊ РЅРµСЃРѕС…СЂР°РЅС‘РЅРЅС‹Рµ РёР·РјРµРЅРµРЅРёСЏ' })}
                  </div>
                )}
                <HelpTooltip content={t('help.settings.obs.resetDefaults', { defaultValue: 'Reset all overlay appearance settings back to defaults.' })}>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="glass-btn"
                    onClick={resetOverlayToDefaults}
                    disabled={savingOverlaySettings || loadingOverlaySettings}
                    leftIcon={
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12a9 9 0 101.8-5.4" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4v6h6" />
                      </svg>
                    }
                  >
                    <span className="hidden sm:inline">{t('admin.overlayResetDefaults')}</span>
                  </Button>
                </HelpTooltip>
                {/* Import/Export removed: users can save custom presets locally instead */}
                <button
                  type="button"
                  className={`glass-btn px-4 py-2 text-sm font-semibold ${overlaySettingsDirty ? '' : 'opacity-60'}`}
                  disabled={!overlaySettingsDirty || savingOverlaySettings || loadingOverlaySettings}
                  onClick={() => void handleSaveOverlaySettings()}
                >
                  {savingOverlaySettings ? t('admin.saving') : t('common.save')}
                </button>
              </div>
            </div>
          </div>

          {obsUiMode === 'basic' && (
            <OverlayBasicPanel overlayForm={overlayForm} overlaySettings={overlaySettings} preview={preview} />
          )}

          <OverlayProPanel overlayForm={overlayForm} preview={preview} />
        </div>
      </div>
      </details>
    </>
  );
}

export default LinkEditor;
