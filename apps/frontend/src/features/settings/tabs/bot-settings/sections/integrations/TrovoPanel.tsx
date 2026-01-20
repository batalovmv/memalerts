import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { Button, Spinner, Textarea } from '@/shared/ui';

import { ToggleSwitch } from '../../components/ToggleSwitch';
import type { UseBotSettingsResult } from '../../hooks/useBotSettings';

type TrovoPanelProps = {
  settings: UseBotSettingsResult;
};

export const TrovoPanel = ({ settings }: TrovoPanelProps) => {
  const { t } = useTranslation();
  const {
    trovoLinked,
    botsLoaded,
    botsLoading,
    trovoEnabled,
    trovoBusy,
    toggleTrovoIntegration,
    trovoOverrideStatus,
    trovoOverrideBusy,
    trovoOverrideLoading,
    preflightAndRedirectToOverrideLink,
    disconnectTrovoOverride,
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
      {!trovoLinked ? (
        <div className="glass p-5 sm:p-6 mb-4">
          <div className="font-semibold text-gray-900 dark:text-white">
            {t('settings.accountsServiceTrovoHint', { defaultValue: 'Нужно привязать Trovo аккаунт в Accounts.' })}
          </div>
          <div className="mt-2">
            <Link to="/settings/accounts" className="underline hover:no-underline text-sm">
              {t('settings.goToAccounts', { defaultValue: 'Привязать аккаунт' })}
            </Link>
          </div>
        </div>
      ) : null}

      {trovoLinked ? (
        <div className="glass p-5 sm:p-6 mb-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="font-semibold text-gray-900 dark:text-white">
                {t('admin.trovoOverrideTitle', { defaultValue: 'Свой бот' })}
              </div>
              {isOverrideConnectedButLocked(trovoOverrideStatus) ? (
                <div className="text-xs text-amber-800 dark:text-amber-200 mt-1">
                  {t('subscription.overrideConnectedButLocked', {
                    defaultValue: 'Бот подключен, но не используется без подписки. Сейчас работает глобальный бот.',
                  })}
                </div>
              ) : null}
            </div>
            <ToggleSwitch
              checked={trovoOverrideStatus?.enabled === true}
              disabled={trovoOverrideBusy || trovoOverrideLoading}
              busy={trovoOverrideBusy || trovoOverrideLoading}
              onChange={(next) => {
                if (next) void preflightAndRedirectToOverrideLink('trovo');
                else void disconnectTrovoOverride();
              }}
              ariaLabel={t('admin.trovoOverrideTitle', { defaultValue: 'Свой бот' })}
            />
          </div>
          {isCustomBotConnectLocked ? (
            <div className="mt-2 text-xs text-amber-800 dark:text-amber-200">
              {t('subscription.availableOnlyWithSubscription', { defaultValue: 'по заявкам' })}
            </div>
          ) : null}
        </div>
      ) : null}

      {trovoLinked ? (
        <div className="glass p-5 sm:p-6 mb-4 relative">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="font-semibold text-gray-900 dark:text-white">Trovo</div>
              <div className="text-sm text-gray-600 dark:text-gray-300 mt-1">
                {t('admin.trovoBotIntegrationLabel', { defaultValue: 'Включить Trovo-бота для канала.' })}
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                {t('admin.autoRewardsTrovoMappingHint', {
                  defaultValue:
                    'Auto rewards mapping (twitchAutoRewards): type 5003 – follow, 5001 – subscribe, 5005/5006 – giftSub, 5008 – raid, 0 – chat.*, 5012 используется для границ стрима (счётчики per-stream).',
                })}
              </div>
            </div>
            {botsLoading ? <Spinner className="h-5 w-5" /> : null}
            <ToggleSwitch
              checked={trovoEnabled}
              disabled={!botsLoaded || botsLoading || trovoBusy}
              busy={trovoBusy}
              onChange={(next) => void toggleTrovoIntegration(next)}
              ariaLabel={t('admin.trovoBotIntegrationLabel', { defaultValue: 'Trovo bot enabled' })}
            />
          </div>
        </div>
      ) : null}

      <div className="glass p-5 sm:p-6">
        <div className="font-semibold text-gray-900 dark:text-white">
          {t('admin.botTestMessageTitle', { defaultValue: 'Test message' })}
        </div>
        <div className="text-sm text-gray-600 dark:text-gray-300 mt-1">
          {t('admin.botTestMessageHintTrovo', {
            defaultValue: 'Send a message from the bot into your Trovo chat to confirm it works.',
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
              void sendTestMessage('trovo');
            }}
            disabled={sendingTestMessage}
          >
            {t('admin.sendTestMessage', { defaultValue: 'Send test message' })}
          </Button>
          {renderOutboxStatus('trovo')}
          {!trovoEnabled && (
            <div className="text-xs text-amber-800 dark:text-amber-200">
              {t('admin.trovoEnableRequiredToSend', { defaultValue: 'Сначала включите Trovo-бота для канала.' })}
            </div>
          )}
        </div>
      </div>
    </>
  );
};
