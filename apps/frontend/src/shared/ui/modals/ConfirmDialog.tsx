import type { ReactNode } from 'react';

import { Modal } from '@/shared/ui/Modal/Modal';

interface ConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string | ReactNode;
  confirmText?: string;
  cancelText?: string;
  confirmButtonClass?: string;
  isLoading?: boolean;
}

export default function ConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  confirmButtonClass = 'bg-red-600 hover:bg-red-700',
  isLoading = false,
}: ConfirmDialogProps) {
  const titleId = 'confirm-dialog-title';

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      ariaLabelledBy={titleId}
      closeOnEsc={false}
      contentClassName="max-w-md p-4 sm:p-6"
    >
      <h2 id={titleId} className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white mb-3 sm:mb-4">
        {title}
      </h2>
      <div className="text-gray-700 dark:text-gray-300 mb-4 sm:mb-6">{message}</div>
      <div className="flex flex-col-reverse sm:flex-row gap-3 sm:justify-end">
        <button
          onClick={onClose}
          disabled={isLoading}
          className="w-full sm:w-auto px-4 py-3 sm:py-2.5 rounded-xl bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200 transition-colors font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {cancelText}
        </button>
        <button
          onClick={onConfirm}
          disabled={isLoading}
          className={`w-full sm:w-auto px-4 py-3 sm:py-2.5 rounded-xl text-white transition-colors font-semibold disabled:opacity-50 disabled:cursor-not-allowed ${confirmButtonClass}`}
        >
          {isLoading ? 'Processing...' : confirmText}
        </button>
      </div>
    </Modal>
  );
}


