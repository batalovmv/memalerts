import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { SubmitModalProps } from '@/features/submit/model/submitModalTypes';

import { useSubmitModalState } from '@/features/submit/model/useSubmitModalState';
import { SubmitBlockedState } from '@/features/submit/ui/submit-modal/SubmitBlockedState';
import { SubmitFooter } from '@/features/submit/ui/submit-modal/SubmitFooter';
import { SubmitImportPanel } from '@/features/submit/ui/submit-modal/SubmitImportPanel';
import { SubmitInfoPanel } from '@/features/submit/ui/submit-modal/SubmitInfoPanel';
import { SubmitMetaFields } from '@/features/submit/ui/submit-modal/SubmitMetaFields';
import { SubmitModalHeader } from '@/features/submit/ui/submit-modal/SubmitModalHeader';
import { SubmitModeSelector } from '@/features/submit/ui/submit-modal/SubmitModeSelector';
import { SubmitUploadPanel } from '@/features/submit/ui/submit-modal/SubmitUploadPanel';
import { Modal } from '@/shared/ui';

export type { SubmitModalProps } from '@/features/submit/model/submitModalTypes';

const SubmitModal = memo(function SubmitModal({
  isOpen,
  onClose,
  channelSlug,
  channelId,
  initialBlockedReason = null,
}: SubmitModalProps) {
  const { t } = useTranslation();
  const {
    blockedReason,
    blockedCopy,
    canSubmit,
    errorMessage,
    file,
    filePreview,
    formData,
    handleCancelUpload,
    handleFileChange,
    handleOpenPool,
    handleRetry,
    handleSubmit,
    handleSubmitAnother,
    importLoading,
    isOwnerBypassTarget,
    isSubmitLocked,
    isUploading,
    isValidating,
    mode,
    retryAfterSeconds,
    setFormData,
    setMode,
    uploadProgress,
    uploadStatus,
    validationErrors,
  } = useSubmitModalState({ isOpen, onClose, channelSlug, channelId, initialBlockedReason });

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      closeOnEsc={false}
      overlayClassName="overflow-y-auto"
      contentClassName="relative rounded-2xl max-w-2xl max-h-[90vh] overflow-y-auto"
      ariaLabel={t('submitModal.title')}
    >
      <SubmitModalHeader onClose={onClose} />
      <div className="p-4 sm:p-6">
        {blockedReason && blockedCopy ? (
          <SubmitBlockedState blockedCopy={blockedCopy} onClose={onClose} />
        ) : (
          <>
            <SubmitModeSelector mode={mode} onModeChange={setMode} onOpenPool={handleOpenPool} />

            <form onSubmit={handleSubmit} className="space-y-4">
              {mode === 'upload' ? (
                <SubmitUploadPanel
                  isUploading={isUploading}
                  filePreview={filePreview}
                  validationErrors={validationErrors}
                  uploadStatus={uploadStatus}
                  uploadProgress={uploadProgress}
                  errorMessage={errorMessage}
                  onFileChange={handleFileChange}
                />
              ) : (
                <SubmitImportPanel
                  sourceUrl={formData.sourceUrl}
                  onSourceUrlChange={(next) => setFormData((prev) => ({ ...prev, sourceUrl: next }))}
                  importLoading={importLoading}
                />
              )}

              <SubmitMetaFields
                formData={formData}
                isSubmitLocked={isSubmitLocked}
                onTitleChange={(next) => setFormData((prev) => ({ ...prev, title: next }))}
                onTagsChange={(next) => setFormData((prev) => ({ ...prev, tags: next }))}
              />

              <SubmitInfoPanel isOwnerBypassTarget={isOwnerBypassTarget} />

              <SubmitFooter
                mode={mode}
                uploadStatus={uploadStatus}
                hasFile={Boolean(file)}
                canSubmit={canSubmit}
                isValidating={isValidating}
                isSubmitLocked={isSubmitLocked}
                retryAfterSeconds={retryAfterSeconds}
                importLoading={importLoading}
                onClose={onClose}
                onCancelUpload={handleCancelUpload}
                onSubmitAnother={handleSubmitAnother}
                onRetry={handleRetry}
              />
            </form>
          </>
        )}
      </div>
    </Modal>
  );
});

export default SubmitModal;
