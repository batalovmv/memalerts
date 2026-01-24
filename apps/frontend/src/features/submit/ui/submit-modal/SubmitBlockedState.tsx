import { useTranslation } from 'react-i18next';

import { Button } from '@/shared/ui';

type SubmitBlockedStateProps = {
  blockedCopy: string;
  onClose: () => void;
};

export function SubmitBlockedState({ blockedCopy, onClose }: SubmitBlockedStateProps) {
  const { t } = useTranslation();

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-danger/10 ring-1 ring-danger/20 p-4">
        <div className="text-base font-semibold text-gray-900 dark:text-white">
          {t('submitModal.unavailableTitle', { defaultValue: 'Отправка недоступна' })}
        </div>
        <div className="mt-2 text-sm text-gray-700 dark:text-gray-300">{blockedCopy}</div>
      </div>
      <div className="flex justify-end">
        <Button type="button" variant="secondary" onClick={onClose}>
          {t('common.close', { defaultValue: 'Close' })}
        </Button>
      </div>
    </div>
  );
}
