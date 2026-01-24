import { useTranslation } from 'react-i18next';

import { Button } from '@/shared/ui';

type PendingSubmissionsEmptyStateProps = {
  pendingError?: string | null;
  submissionsLoading: boolean;
  onRetryPending?: () => void;
};

export function PendingSubmissionsEmptyState({ pendingError, submissionsLoading, onRetryPending }: PendingSubmissionsEmptyStateProps) {
  const { t } = useTranslation();

  if (pendingError && !submissionsLoading) {
    return (
      <div className="rounded-lg bg-gray-50 dark:bg-gray-900/30 p-6 text-gray-700 dark:text-gray-300 shadow-sm">
        <div className="font-semibold mb-1">{t('common.requestFailed', { defaultValue: 'Request failed' })}</div>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          {t('dashboard.failedToLoadPendingSubmissions', { defaultValue: 'Failed to load pending submissions.' })}
        </p>
        {onRetryPending ? (
          <div className="mt-4">
            <Button type="button" variant="secondary" onClick={onRetryPending}>
              {t('common.retry', { defaultValue: 'Retry' })}
            </Button>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="rounded-lg bg-gray-50 dark:bg-gray-900/30 p-6 text-gray-700 dark:text-gray-300 shadow-sm">
      <div className="font-semibold mb-1">{t('dashboard.noSubmissionsFound', { defaultValue: 'No submissions found.' })}</div>
      <p className="text-sm text-gray-600 dark:text-gray-400">
        {t('dashboard.noPendingSubmissionsHint', { defaultValue: 'New submissions will appear here automatically.' })}
      </p>
    </div>
  );
}
