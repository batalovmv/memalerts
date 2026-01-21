import { useTranslation } from 'react-i18next';

import { CreditsOverlaySettings } from '../../CreditsOverlaySettings';

import { CreditsAdvancedTabs } from './credits/CreditsAdvancedTabs';
import { CreditsQuickControls } from './credits/CreditsQuickControls';
import { CreditsSessionPanel } from './credits/CreditsSessionPanel';

import type { CreditsSessionState } from '../hooks/useCreditsSession';
import type { CreditsSettingsState } from '../hooks/useCreditsSettings';
import type { OverlayPreviewState } from '../hooks/useOverlayPreview';

type CreditsEditorProps = {
  creditsSettings: CreditsSettingsState;
  creditsSession: CreditsSessionState;
  preview: OverlayPreviewState;
};

export function CreditsEditor({ creditsSettings, creditsSession, preview }: CreditsEditorProps) {
  const { t } = useTranslation();
  const { loadingCreditsSettings, savingCreditsSettings, creditsSettingsSavedPulse, creditsSettingsDirty, handleSaveCreditsSettings } =
    creditsSettings;
  const { previewIframeRef, activePreviewBaseUrl, schedulePostPreviewParams } = preview;

  return (
    <CreditsOverlaySettings
      isLoading={loadingCreditsSettings}
      isSaving={savingCreditsSettings}
      savedPulse={creditsSettingsSavedPulse}
      savingLabel={t('admin.saving')}
      savedLabel={t('admin.saved')}
    >
      <CreditsSessionPanel creditsSession={creditsSession} />
      <CreditsQuickControls creditsSettings={creditsSettings} />
      <CreditsAdvancedTabs creditsSettings={creditsSettings} />

      <div className="rounded-2xl overflow-hidden border border-white/20 dark:border-white/10 bg-black/40">
        {activePreviewBaseUrl ? (
          <iframe
            ref={previewIframeRef}
            aria-label={t('help.settings.obs.previewFrame', { defaultValue: 'Preview frame' })}
            src={activePreviewBaseUrl}
            className="w-full"
            style={{ aspectRatio: '16 / 9', border: '0' }}
            onLoad={() => {
              schedulePostPreviewParams({ immediate: true });
              window.setTimeout(() => schedulePostPreviewParams({ immediate: true }), 50);
              window.setTimeout(() => schedulePostPreviewParams({ immediate: true }), 250);
            }}
          />
        ) : (
          <div className="w-full flex items-center justify-center text-sm text-white/70" style={{ aspectRatio: '16 / 9' }}>
            {t('common.notAvailable', { defaultValue: 'Not available' })}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="text-xs text-gray-600 dark:text-gray-300">
          {creditsSettingsDirty ? t('admin.unsavedChanges', { defaultValue: 'Есть несохранённые изменения' }) : ''}
        </div>
        <button
          type="button"
          onClick={() => void handleSaveCreditsSettings()}
          disabled={!creditsSettingsDirty || savingCreditsSettings || loadingCreditsSettings}
          className="px-4 py-2 rounded-lg bg-primary text-white disabled:opacity-60"
        >
          {savingCreditsSettings ? t('admin.saving', { defaultValue: 'Saving...' }) : t('admin.save', { defaultValue: 'Save' })}
        </button>
      </div>
    </CreditsOverlaySettings>
  );
}

export default CreditsEditor;
