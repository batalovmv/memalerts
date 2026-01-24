import { useTranslation } from 'react-i18next';

import type { SubmitMode } from '@/features/submit/model/submitModalTypes';

import { Button, HelpTooltip } from '@/shared/ui';

type SubmitModeSelectorProps = {
  mode: SubmitMode;
  onModeChange: (mode: SubmitMode) => void;
  onOpenPool: () => void;
};

export function SubmitModeSelector({ mode, onModeChange, onOpenPool }: SubmitModeSelectorProps) {
  const { t } = useTranslation();

  return (
    <div className="mb-6 glass p-3 sm:p-4">
      <div className="flex gap-3" role="tablist" aria-label={t('submitModal.mode', { defaultValue: 'Submit mode' })}>
        <HelpTooltip content={t('help.submitModal.modeUpload', { defaultValue: 'Upload a video file from your device.' })}>
          <button
            type="button"
            onClick={() => onModeChange('upload')}
            className={`flex-1 py-2 px-4 rounded-lg font-medium transition-colors ${
              mode === 'upload'
                ? 'bg-primary text-white'
                : 'bg-white/40 dark:bg-white/5 text-gray-700 dark:text-gray-200 hover:bg-white/60 dark:hover:bg-white/10'
            }`}
            role="tab"
            id="submit-modal-tab-upload"
            aria-controls="submit-modal-panel-upload"
            aria-selected={mode === 'upload'}
            tabIndex={mode === 'upload' ? 0 : -1}
          >
            {t('submit.uploadVideo')}
          </button>
        </HelpTooltip>
        <HelpTooltip content={t('help.submitModal.modeImport', { defaultValue: 'Import by pasting a direct Memealerts media link.' })}>
          <button
            type="button"
            onClick={() => onModeChange('import')}
            className={`flex-1 py-2 px-4 rounded-lg font-medium transition-colors ${
              mode === 'import'
                ? 'bg-primary text-white'
                : 'bg-gray-100 dark:bg-gray-600 text-gray-700 dark:text-gray-300 hover:bg-secondary/10 dark:hover:bg-secondary/10'
            }`}
            role="tab"
            id="submit-modal-tab-import"
            aria-controls="submit-modal-panel-import"
            aria-selected={mode === 'import'}
            tabIndex={mode === 'import' ? 0 : -1}
          >
            {t('submit.import')}
          </button>
        </HelpTooltip>
      </div>
      <div className="mt-3 flex justify-end">
        <HelpTooltip content={t('help.submitModal.openPool', { defaultValue: 'Open the Pool to choose a ready meme instead of uploading.' })}>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="glass-btn bg-white/40 dark:bg-white/5"
            onClick={onOpenPool}
          >
            {t('submitModal.openPool', { defaultValue: 'Open pool' })}
          </Button>
        </HelpTooltip>
      </div>
    </div>
  );
}
