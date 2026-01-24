import { useTranslation } from 'react-i18next';

import type { MySubmission } from '@/features/submit/types';

import { NeedsChangesSubmissionCard } from '@/features/submit/components/NeedsChangesSubmissionCard';
import { Pill, Spinner } from '@/shared/ui';

type MySubmissionsListProps = {
  mySubmissionsLoading: boolean;
  mySorted: MySubmission[];
  onRefreshMySubmissions: () => void;
};

export function MySubmissionsList({ mySubmissionsLoading, mySorted, onRefreshMySubmissions }: MySubmissionsListProps) {
  const { t } = useTranslation();

  if (mySubmissionsLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
        <Spinner className="h-4 w-4" />
        {t('common.loading', { defaultValue: 'Loading…' })}
      </div>
    );
  }

  if (mySorted.length === 0) {
    return (
      <div className="rounded-lg bg-gray-50 dark:bg-gray-900/30 p-6 text-gray-700 dark:text-gray-300 shadow-sm">
        <div className="font-semibold mb-1">{t('submit.noSubmissionsYet', { defaultValue: 'No submissions yet.' })}</div>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          {t('dashboard.submissionsPanel.myHint', {
            defaultValue: 'Here you will see the submissions you sent to other channels.',
          })}
        </p>
      </div>
    );
  }

  return (
    <ul className="space-y-3" role="list">
      {mySorted.slice(0, 50).map((s) => {
        if (s.status === 'needs_changes') {
          return (
            <li key={s.id}>
              <NeedsChangesSubmissionCard submission={s} onUpdated={onRefreshMySubmissions} />
            </li>
          );
        }

        return (
          <li key={s.id}>
            <article className="glass p-4">
              <header className="flex items-start justify-between gap-4">
                <div>
                  <div className="font-semibold text-gray-900 dark:text-white">{s.title}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">{new Date(s.createdAt).toLocaleString()}</div>
                </div>
                <Pill variant="neutral">{t('submissions.statusPending', { defaultValue: 'pending' })}</Pill>
              </header>
            </article>
          </li>
        );
      })}
    </ul>
  );
}
