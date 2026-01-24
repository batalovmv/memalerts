import { useTranslation } from 'react-i18next';

import { HelpTooltip } from '@/shared/ui';

type SubmitModalHeaderProps = {
  onClose: () => void;
};

export function SubmitModalHeader({ onClose }: SubmitModalHeaderProps) {
  const { t } = useTranslation();

  return (
    <div className="sticky top-0 border-b border-black/5 dark:border-white/10 px-4 sm:px-6 py-4 flex justify-between items-center">
      <h2 className="text-xl sm:text-2xl font-bold dark:text-white">{t('submitModal.title')}</h2>
      <HelpTooltip content={t('help.submitModal.close', { defaultValue: 'Close without sending.' })}>
        <button
          type="button"
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          aria-label={t('submitModal.closeModal')}
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </HelpTooltip>
    </div>
  );
}
