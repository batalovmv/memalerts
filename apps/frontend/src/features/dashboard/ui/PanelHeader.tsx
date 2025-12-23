import type { ReactNode } from 'react';

import { useTranslation } from 'react-i18next';

export type DashboardPanelHeaderProps = {
  title: ReactNode;
  meta?: ReactNode;
  onClose: () => void;
  closeAriaLabel?: string;
};

export function PanelHeader({ title, meta, onClose, closeAriaLabel }: DashboardPanelHeaderProps) {
  const { t } = useTranslation();

  return (
    <div className="surface-header">
      <div className="flex items-center gap-3 min-w-0">
        <h2 className="text-xl font-bold dark:text-white truncate">{title}</h2>
        {meta ? <div className="shrink-0">{meta}</div> : null}
      </div>
      <button
        onClick={onClose}
        className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
        aria-label={closeAriaLabel || t('common.close', { defaultValue: 'Close' })}
      >
        <svg className="w-5 h-5 text-gray-600 dark:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}


