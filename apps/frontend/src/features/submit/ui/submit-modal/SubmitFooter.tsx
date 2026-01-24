import { useTranslation } from 'react-i18next';

import type { SubmitMode, UploadStatus } from '@/features/submit/model/submitModalTypes';

import { Button, HelpTooltip } from '@/shared/ui';

type SubmitFooterProps = {
  mode: SubmitMode;
  uploadStatus: UploadStatus;
  hasFile: boolean;
  canSubmit: boolean;
  isValidating: boolean;
  isSubmitLocked: boolean;
  retryAfterSeconds: number;
  importLoading: boolean;
  onClose: () => void;
  onCancelUpload: () => void;
  onSubmitAnother: () => void;
  onRetry: () => void;
};

export function SubmitFooter({
  mode,
  uploadStatus,
  hasFile,
  canSubmit,
  isValidating,
  isSubmitLocked,
  retryAfterSeconds,
  importLoading,
  onClose,
  onCancelUpload,
  onSubmitAnother,
  onRetry,
}: SubmitFooterProps) {
  const { t } = useTranslation();

  return (
    <div className="flex gap-3 pt-4">
      <Button type="button" variant="secondary" className="flex-1" onClick={onClose} disabled={isSubmitLocked}>
        {t('common.cancel')}
      </Button>
      {mode === 'upload' ? (
        uploadStatus === 'uploading' ? (
          <Button type="button" variant="secondary" className="flex-1" onClick={onCancelUpload}>
            {t('submit.cancel', { defaultValue: 'Cancel' })}
          </Button>
        ) : uploadStatus === 'success' ? (
          <Button type="button" variant="primary" className="flex-1" onClick={onSubmitAnother}>
            {t('submit.submitAnother', { defaultValue: 'Submit another' })}
          </Button>
        ) : uploadStatus === 'error' ? (
          <Button type="button" variant="primary" className="flex-1" onClick={onRetry} disabled={retryAfterSeconds > 0}>
            {retryAfterSeconds > 0
              ? t('submit.retryIn', { defaultValue: 'Try again in {{seconds}}s', seconds: retryAfterSeconds })
              : t('submit.retry', { defaultValue: 'Try again' })}
          </Button>
        ) : (
          <HelpTooltip content={t('help.submitModal.submit', { defaultValue: 'Send the meme for review. If this is your own channel, it will be added instantly.' })}>
            <Button
              type="submit"
              variant="primary"
              className="flex-1"
              disabled={!hasFile || !canSubmit || isValidating || isSubmitLocked}
            >
              {t('submit.submitButton', { defaultValue: 'Add' })}
            </Button>
          </HelpTooltip>
        )
      ) : (
        <HelpTooltip content={t('help.submitModal.submit', { defaultValue: 'Send the meme for review. If this is your own channel, it will be added instantly.' })}>
          <Button type="submit" variant="primary" className="flex-1" disabled={importLoading}>
            {importLoading ? t('submit.submitting') : t('submit.submitButton', { defaultValue: 'Add' })}
          </Button>
        </HelpTooltip>
      )}
    </div>
  );
}
