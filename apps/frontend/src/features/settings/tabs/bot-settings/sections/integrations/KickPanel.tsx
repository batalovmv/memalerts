import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { Button, Spinner, Textarea } from '@/shared/ui';

import { ToggleSwitch } from '../../components/ToggleSwitch';
import type { UseBotSettingsResult } from '../../hooks/useBotSettings';

type KickPanelProps = {
  settings: UseBotSettingsResult;
};

export const KickPanel = ({ settings }: KickPanelProps) => {
  const { t } = useTranslation();
  const {
    kickLinked,
    botsLoaded,
    botsLoading,
    kickEnabled,
    kickBusy,
    toggleKickIntegration,
    kickOverrideStatus,
    kickOverrideBusy,
    kickOverrideLoading,
    preflightAndRedirectToOverrideLink,
    disconnectKickOverride,
    isOverrideConnectedButLocked,
    isCustomBotConnectLocked,
    testMessage,
    setTestMessage,
    sendTestMessage,
    sendingTestMessage,
    renderOutboxStatus,
  } = settings;

  return (
    <>
      {!kickLinked ? (
        <div className="glass p-5 sm:p-6 mb-4">
          <div className="font-semibold text-gray-900 dark:text-white">
            {t('settings.accountsServiceKickHint', { defaultValue: 'Нужно привязать Kick аккаунт в Accounts.' })}
          </div>
          <div className="mt-2">
            <Link to="/settings/accounts" className="underline hover:no-underline text-sm">
              {t('settings.goToAccounts', { defaultValue: 'Привязать аккаунт' })}
            </Link>
          </div>
        </div>
      ) : null}

      {kickLinked ? (
        <div className="glass p-5 sm:p-6 mb-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="font-semibold text-gray-900 dark:text-white">
                {t('admin.kickOverrideTitle', { defaultValue: 'Свой бот' })}
              </div>
              {isOverrideConnectedButLocked(kickOverrideStatus) ? (
                <div className="text-xs text-amber-800 dark:text-amber-200 mt-1">
                  {t('subscription.overrideConnectedButLocked', {
                    defaultValue: 'Бот подключен, но не используется без подписки. Сейчас работает глобальный бот.',
                  })}
                </div>
              ) : null}
            </div>
            <ToggleSwitch
              checked={kickOverrideStatus?.enabled === true}
              disabled={kickOverrideBusy || kickOverrideLoading}
              busy={kickOverrideBusy || kickOverrideLoading}
              onChange={(next) => {
                if (next) void preflightAndRedirectToOverrideLink('kick');
                else void disconnectKickOverride();
              }}
              ariaLabel={t('admin.kickOverrideTitle', { defaultValue: 'Свой бот' })}
            />
          </div>
          {isCustomBotConnectLocked ? (
            <div className="mt-2 text-xs text-amber-800 dark:text-amber-200">
              {t('subscription.availableOnlyWithSubscription', { defaultValue: 'по заявкам' })}
            </div>
          ) : null}
        </div>
      ) : null}

      {kickLinked ? (
        <div className="glass p-5 sm:p-6 mb-4 relative">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="font-semibold text-gray-900 dark:text-white">Kick</div>
              <div className="text-sm text-gray-600 dark:text-gray-300 mt-1">
                {t('admin.kickBotIntegrationLabel', { defaultValue: 'Включить Kick-бота для канала.' })}
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                {t('admin.autoRewardsKickMappingHint', {
                  defaultValue:
                    'Auto rewards mapping (twitchAutoRewards): channel.followed – follow, channel.subscription.new – subscribe, channel.subscription.renewal – resubMessage, channel.subscription.gifts – giftSub, kicks.gifted – cheer (bitsPerCoin/minBits используются как kicksPerCoin/minKicks), chat.message.sent – chat.*.',
                })}
              </div>
            </div>
            {botsLoading ? <Spinner className="h-5 w-5" /> : null}
            <ToggleSwitch
              checked={kickEnabled}
              disabled={!botsLoaded || botsLoading || kickBusy}
              busy={kickBusy}
              onChange={(next) => void toggleKickIntegration(next)}
              ariaLabel={t('admin.kickBotIntegrationLabel', { defaultValue: 'Kick bot enabled' })}
            />
          </div>
        </div>
      ) : null}

      <div className="glass p-5 sm:p-6">
        <div className="font-semibold text-gray-900 dark:text-white">
          {t('admin.botTestMessageTitle', { defaultValue: 'Test message' })}
        </div>
        <div className="text-sm text-gray-600 dark:text-gray-300 mt-1">
          {t('admin.botTestMessageHintKick', {
            defaultValue: 'Send a message from the bot into your Kick chat to confirm it works.',
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
              void sendTestMessage('kick');
            }}
            disabled={sendingTestMessage}
          >
            {t('admin.sendTestMessage', { defaultValue: 'Send test message' })}
          </Button>
          {renderOutboxStatus('kick')}
          {!kickEnabled && (
            <div className="text-xs text-amber-800 dark:text-amber-200">
              {t('admin.kickEnableRequiredToSend', { defaultValue: 'Сначала включите Kick-бота для канала.' })}
            </div>
          )}
        </div>
      </div>
    </>
  );
};
