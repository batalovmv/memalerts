import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { Button, Spinner, Textarea } from '@/shared/ui';

import { ToggleSwitch } from '../../components/ToggleSwitch';
import type { UseBotSettingsResult } from '../../hooks/useBotSettings';

type VkPanelProps = {
  settings: UseBotSettingsResult;
};

export const VkPanel = ({ settings }: VkPanelProps) => {
  const { t } = useTranslation();
  const {
    vkvideoLinked,
    botsLoaded,
    botsLoading,
    vkEnabled,
    vkBusy,
    vkvideoNotAvailable,
    toggleVkvideoIntegration,
    vkvideoOverrideStatus,
    vkvideoOverrideBusy,
    vkvideoOverrideLoading,
    preflightAndRedirectToOverrideLink,
    disconnectVkvideoOverride,
    isOverrideConnectedButLocked,
    isCustomBotConnectLocked,
    testMessage,
    setTestMessage,
    sendTestMessage,
    sendingTestMessage,
    renderOutboxStatus,
    lastOutbox,
  } = settings;

  return (
    <>
      {!vkvideoLinked ? (
        <div className="glass p-5 sm:p-6 mb-4">
          <div className="font-semibold text-gray-900 dark:text-white">
            {t('settings.accountsServiceVkvideoHint', { defaultValue: 'Нужно привязать VKVideo аккаунт в Accounts.' })}
          </div>
          <div className="mt-2">
            <Link to="/settings/accounts" className="underline hover:no-underline text-sm">
              {t('settings.goToAccounts', { defaultValue: 'Привязать аккаунт' })}
            </Link>
          </div>
        </div>
      ) : (
        <>
          <div className="glass p-5 sm:p-6 mb-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="font-semibold text-gray-900 dark:text-white">
                  {t('admin.vkvideoOverrideTitle', { defaultValue: 'Свой бот' })}
                </div>
                {isOverrideConnectedButLocked(vkvideoOverrideStatus) ? (
                  <div className="text-xs text-amber-800 dark:text-amber-200 mt-1">
                    {t('subscription.overrideConnectedButLocked', {
                      defaultValue: 'Бот подключен, но не используется без подписки. Сейчас работает глобальный бот.',
                    })}
                  </div>
                ) : null}
              </div>
              <ToggleSwitch
                checked={vkvideoOverrideStatus?.enabled === true}
                disabled={vkvideoOverrideBusy || vkvideoOverrideLoading}
                busy={vkvideoOverrideBusy || vkvideoOverrideLoading}
                onChange={(next) => {
                  if (next) void preflightAndRedirectToOverrideLink('vkvideo');
                  else void disconnectVkvideoOverride();
                }}
                ariaLabel={t('admin.vkvideoOverrideTitle', { defaultValue: 'Свой бот' })}
              />
            </div>
            {isCustomBotConnectLocked ? (
              <div className="mt-2 text-xs text-amber-800 dark:text-amber-200">
                {t('subscription.availableOnlyWithSubscription', { defaultValue: 'по заявкам' })}
              </div>
            ) : null}
          </div>

          <div className="glass p-5 sm:p-6 mb-4 relative">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="font-semibold text-gray-900 dark:text-white">VK Video Live</div>
                <div className="text-sm text-gray-600 dark:text-gray-300 mt-1">
                  {vkvideoNotAvailable
                    ? t('admin.featureNotAvailableShort', { defaultValue: 'Not available on this server.' })
                    : t('admin.vkvideoBotIntegrationLabel', { defaultValue: 'Включить VKVideo-бота для канала.' })}
                </div>
              </div>
              {botsLoading ? <Spinner className="h-5 w-5" /> : null}
              <ToggleSwitch
                checked={vkEnabled}
                disabled={!botsLoaded || botsLoading || vkBusy || vkvideoNotAvailable}
                busy={vkBusy}
                onChange={(next) => void toggleVkvideoIntegration(next)}
                ariaLabel={t('admin.vkvideoBotIntegrationLabel', { defaultValue: 'VKVideo bot enabled' })}
              />
            </div>
          </div>
        </>
      )}

      <div className="glass p-5 sm:p-6">
        <div className="font-semibold text-gray-900 dark:text-white">
          {t('admin.botTestMessageTitle', { defaultValue: 'Test message' })}
        </div>
        <div className="text-sm text-gray-600 dark:text-gray-300 mt-1">
          {t('admin.botTestMessageHintVk', {
            defaultValue: 'Send a message from the bot into your VKVideo chat. This helps confirm the bot is connected.',
          })}
        </div>

        <div className="mt-3 space-y-3">
          <Textarea
            rows={2}
            value={testMessage}
            onChange={(e) => setTestMessage(e.target.value)}
            placeholder={t('admin.botDefaultTestMessage', { defaultValue: 'Bot connected ?' })}
          />
          <Button
            type="button"
            variant="primary"
            onClick={() => {
              void sendTestMessage('vkvideo');
            }}
            disabled={sendingTestMessage}
          >
            {t('admin.sendTestMessage', { defaultValue: 'Send test message' })}
          </Button>
          {renderOutboxStatus('vkvideo')}
          {lastOutbox?.provider === 'vkvideo' && String(lastOutbox.status || '').toLowerCase() === 'pending' ? (
            <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
              {t('admin.vkvideoOutboxPendingHint', {
                defaultValue:
                  'pending = сообщение в очереди. Если раннер/консьюмер на сервере не запущен или не подключён к чату - сообщение не появится.',
              })}
            </div>
          ) : null}
          {!vkEnabled && (
            <div className="text-xs text-amber-800 dark:text-amber-200">
              {t('admin.vkvideoEnableRequiredToSend', { defaultValue: 'Сначала включите VKVideo-бота для канала.' })}
            </div>
          )}
        </div>
      </div>
    </>
  );
};
