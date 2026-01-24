import { useTranslation } from 'react-i18next';

import type { UploadStatus } from '@/features/submit/model/submitModalTypes';
import type { ChangeEvent } from 'react';

import { HelpTooltip, Input } from '@/shared/ui';

type SubmitUploadPanelProps = {
  isUploading: boolean;
  filePreview: string | null;
  validationErrors: string[];
  uploadStatus: UploadStatus;
  uploadProgress: number;
  errorMessage: string | null;
  onFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
};

export function SubmitUploadPanel({
  isUploading,
  filePreview,
  validationErrors,
  uploadStatus,
  uploadProgress,
  errorMessage,
  onFileChange,
}: SubmitUploadPanelProps) {
  const { t } = useTranslation();

  return (
    <div role="tabpanel" id="submit-modal-panel-upload" aria-labelledby="submit-modal-tab-upload">
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('submit.videoFile')}</label>
      <HelpTooltip content={t('help.submitModal.file', { defaultValue: 'Choose a video file to upload. Supported: common video formats.' })}>
        <Input key="submit-upload-file" type="file" onChange={onFileChange} required accept="video/*" disabled={isUploading} />
      </HelpTooltip>
      <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('submit.onlyVideos')}</p>
      {filePreview && (
        <div className="mt-4">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            {t('submitModal.preview', 'Preview')}
          </label>
          <div className="rounded-xl p-4 bg-white/50 dark:bg-white/5 ring-1 ring-black/5 dark:ring-white/10">
            <video src={filePreview} controls className="max-w-full max-h-64 mx-auto rounded" />
          </div>
        </div>
      )}
      {validationErrors.length > 0 && (
        <div className="mt-3 text-sm text-red-600 dark:text-red-400 space-y-1">
          {validationErrors.map((err, index) => (
            <p key={`${err}-${index}`}>! {err}</p>
          ))}
        </div>
      )}
      {uploadStatus === 'uploading' && (
        <div className="mt-4 space-y-2">
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div className="bg-primary h-2 rounded-full transition-all" style={{ width: `${uploadProgress}%` }} />
          </div>
          <span className="text-sm text-gray-600 dark:text-gray-400">
            {t('submit.uploading', { defaultValue: 'Uploading...' })} {uploadProgress}%
          </span>
        </div>
      )}
      {uploadStatus === 'success' && (
        <div className="mt-4 rounded-xl bg-primary/10 ring-1 ring-primary/20 p-3 text-sm text-gray-900 dark:text-white">
          {t('submit.success', { defaultValue: 'Meme submitted for moderation' })}
        </div>
      )}
      {uploadStatus === 'error' && errorMessage && (
        <div className="mt-4 text-sm text-red-600 dark:text-red-400">{errorMessage}</div>
      )}
    </div>
  );
}
