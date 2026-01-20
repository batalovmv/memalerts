import { useTranslation } from 'react-i18next';

import ConfirmDialog from '@/components/ConfirmDialog';
import { Button } from '@/shared/ui';

import { useBotCommands } from './hooks/useBotCommands';
import { useBotSettings } from './hooks/useBotSettings';
import { IntegrationsSection } from './sections/IntegrationsSection';

export function BotSettings() {
  const { t } = useTranslation();
  const settings = useBotSettings();
  const commands = useBotCommands({ showMenus: settings.showMenus });

  const {
    subscriptionRequiredModalOpen,
    setSubscriptionRequiredModalOpen,
    subscriptionRequiredModalProvider,
    setSubscriptionRequiredModalProvider,
    billingUrl,
    oauthSubscriptionRequiredBanner,
    setOauthSubscriptionRequiredBanner,
  } = settings;

  return (
    <div className="space-y-6">
      <ConfirmDialog
        isOpen={subscriptionRequiredModalOpen}
        onClose={() => {
          setSubscriptionRequiredModalOpen(false);
          setSubscriptionRequiredModalProvider(null);
        }}
        onConfirm={() => {
          setSubscriptionRequiredModalOpen(false);
          const url = billingUrl;
          setSubscriptionRequiredModalProvider(null);
          if (url) window.open(url, '_blank', 'noopener,noreferrer');
        }}
        title={t('subscription.requiredTitle', { defaultValue: 'Доступно по заявкам' })}
        message={
          <div className="space-y-2">
            <div className="text-sm">
              {t('subscription.requiredBody', {
                defaultValue: 'Подключение "своего бота" доступно по заявкам.',
              })}
            </div>
            {subscriptionRequiredModalProvider ? (
              <div className="text-xs text-gray-600 dark:text-gray-300">
                {t('subscription.provider', { defaultValue: 'Провайдер' })}:{' '}
                <span className="font-mono">{subscriptionRequiredModalProvider}</span>
              </div>
            ) : null}
          </div>
        }
        confirmText={billingUrl ? t('subscription.goToBilling', { defaultValue: 'Перейти к оплате' }) : t('common.close', { defaultValue: 'Закрыть' })}
        cancelText={t('common.close', { defaultValue: 'Закрыть' })}
        confirmButtonClass="bg-primary hover:bg-primary/90"
      />

      <h2 className="text-2xl font-bold mb-2 dark:text-white">{t('admin.botTitle', { defaultValue: 'Бот' })}</h2>
      <p className="text-sm text-gray-600 dark:text-gray-300 mb-5">
        {t('admin.botDescription', {
          defaultValue: 'Здесь - общие команды/шаблоны и подключение ботов для платформ.',
        })}
      </p>

      {oauthSubscriptionRequiredBanner ? (
        <div className="mb-4 rounded-xl border border-amber-200/60 dark:border-amber-300/20 bg-amber-50/80 dark:bg-amber-900/10 p-3">
          <div className="text-sm text-amber-900 dark:text-amber-100 font-semibold">
            {t('subscription.oauthSubscriptionRequiredTitle', { defaultValue: 'Нужна подписка' })}
          </div>
          <div className="mt-1 text-sm text-amber-900/90 dark:text-amber-100/90">
            {t('subscription.oauthSubscriptionRequiredBody', {
              defaultValue: 'Аккаунт привязан, но использовать его как bot sender для канала можно только по подписке.',
            })}
            <span className="ml-2 opacity-80">
              {t('subscription.provider', { defaultValue: 'Провайдер' })}:{' '}
              <span className="font-mono">{oauthSubscriptionRequiredBanner.provider}</span>
            </span>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {billingUrl ? (
              <Button
                type="button"
                variant="primary"
                onClick={() => {
                  window.open(billingUrl, '_blank', 'noopener,noreferrer');
                }}
              >
                {t('subscription.goToBilling', { defaultValue: 'Перейти к оплате' })}
              </Button>
            ) : null}
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setOauthSubscriptionRequiredBanner(null);
              }}
            >
              {t('common.close', { defaultValue: 'Закрыть' })}
            </Button>
          </div>
        </div>
      ) : null}

      <IntegrationsSection settings={settings} commands={commands} />
    </div>
  );
}

export default BotSettings;
