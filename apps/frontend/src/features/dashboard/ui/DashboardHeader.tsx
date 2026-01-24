import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

import { IconButton } from '@/shared/ui';

type DashboardHeaderProps = {
  helpEnabled: boolean;
  onChangeHelpEnabled: (next: boolean) => void;
};

export function DashboardHeader({ helpEnabled, onChangeHelpEnabled }: DashboardHeaderProps) {
  const { t } = useTranslation();

  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <h1 className="text-3xl font-bold mb-2 dark:text-white">{t('dashboard.title', 'Dashboard')}</h1>
        <p className="text-gray-600 dark:text-gray-400">
          {t('dashboard.subtitle', 'Manage your memes and channel settings')}
        </p>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <IconButton
          type="button"
          variant={helpEnabled ? 'primary' : 'secondary'}
          aria-label={t('dashboard.help.toggle', { defaultValue: 'Help tooltips' })}
          onClick={() => {
            const next = !helpEnabled;
            onChangeHelpEnabled(next);
            toast.success(
              next
                ? t('dashboard.help.enabledToast', { defaultValue: 'Help: ON' })
                : t('dashboard.help.disabledToast', { defaultValue: 'Help: OFF' }),
            );
          }}
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M8.25 9a3.75 3.75 0 017.5 0c0 2.25-2.25 2.25-2.25 4.125M12 17.25h.008M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          }
        />
      </div>
    </div>
  );
}
