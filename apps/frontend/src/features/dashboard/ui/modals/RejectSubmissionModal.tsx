import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import { Button, IconButton, Modal, Textarea } from '@/shared/ui';

import { XIcon } from './icons';

export type RejectSubmissionModalProps = {
  isOpen: boolean;
  rejectReason: string;
  onRejectReasonChange: (next: string) => void;
  onClose: () => void;
  onReject: () => void | Promise<void>;
};

export function RejectSubmissionModal({
  isOpen,
  rejectReason,
  onRejectReasonChange,
  onClose,
  onReject,
}: RejectSubmissionModalProps) {
  const { t } = useTranslation();
  const titleId = useId();

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      overlayClassName="overflow-y-auto"
      contentClassName="relative rounded-2xl max-w-md w-full overflow-hidden"
      ariaLabelledBy={titleId}
    >
      <div className="sticky top-0 bg-white/40 dark:bg-black/20 backdrop-blur border-b border-black/5 dark:border-white/10 px-5 py-4 flex items-center justify-between">
        <h2 id={titleId} className="text-lg sm:text-xl font-bold text-gray-900 dark:text-white">
          {t('admin.rejectSubmission', { defaultValue: 'Reject submission' })}
        </h2>
        <IconButton
          icon={<XIcon className="h-5 w-5" />}
          onClick={onClose}
          aria-label={t('common.close', { defaultValue: 'Close' })}
        />
      </div>

      <div className="p-5 space-y-4">
        <div className="space-y-1">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
            {t('admin.rejectionReason', { defaultValue: 'Reason (optional)' })}
          </label>
          <Textarea
            value={rejectReason}
            onChange={(e) => onRejectReasonChange(e.target.value)}
            rows={4}
            placeholder={t('admin.rejectionReasonPlaceholder', { defaultValue: 'Enter a reason (optional)…' })}
          />
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {t('admin.rejectionReasonDescription', { defaultValue: 'This reason will be visible to the submitter' })}
          </p>
        </div>

        <div className="flex gap-3 pt-1">
          <Button type="button" variant="secondary" className="flex-1" onClick={onClose}>
            {t('common.cancel', { defaultValue: 'Cancel' })}
          </Button>
          <Button type="button" variant="danger" className="flex-1" onClick={() => void onReject()}>
            {t('admin.reject', { defaultValue: 'Reject' })}
          </Button>
        </div>
      </div>
    </Modal>
  );
}


