import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import { Button, IconButton, Input, Modal } from '@/shared/ui';

import { XIcon } from './icons';

export type ApproveSubmissionModalProps = {
  isOpen: boolean;
  priceCoins: string;
  onPriceCoinsChange: (next: string) => void;
  onClose: () => void;
  onApprove: () => void | Promise<void>;
};

export function ApproveSubmissionModal({
  isOpen,
  priceCoins,
  onPriceCoinsChange,
  onClose,
  onApprove,
}: ApproveSubmissionModalProps) {
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
          {t('admin.approveSubmission', { defaultValue: 'Approve submission' })}
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
            {t('admin.priceCoins', { defaultValue: 'Price (coins)' })}
          </label>
          <Input
            type="number"
            min={1}
            value={priceCoins}
            onChange={(e) => onPriceCoinsChange(e.target.value)}
            required
            inputMode="numeric"
          />
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {t('admin.priceCoinsDescription', { defaultValue: 'Minimum 1 coin' })}
          </p>
        </div>

        <div className="flex gap-3 pt-1">
          <Button type="button" variant="secondary" className="flex-1" onClick={onClose}>
            {t('common.cancel', { defaultValue: 'Cancel' })}
          </Button>
          <Button type="button" variant="success" className="flex-1" onClick={() => void onApprove()}>
            {t('admin.approve', { defaultValue: 'Approve' })}
          </Button>
        </div>
      </div>
    </Modal>
  );
}


