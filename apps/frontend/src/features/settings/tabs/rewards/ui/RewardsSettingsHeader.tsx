import { useTranslation } from 'react-i18next';

export function RewardsSettingsHeader() {
  const { t } = useTranslation();

  return (
    <div>
      <h2 className="text-2xl font-bold dark:text-white">{t('admin.rewards', { defaultValue: 'Награды' })}</h2>
      <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
        {t('admin.rewardsDescription', { defaultValue: 'Настройка наград и начисления монет за действия зрителей.' })}
      </p>
    </div>
  );
}
