import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { ToggleSwitch } from '../../components/ToggleSwitch';

import type { UseBotSettingsResult } from '../../hooks/useBotSettings';

import { Button, Spinner, Textarea } from '@/shared/ui';

type YouTubePanelProps = {
  settings: UseBotSettingsResult;
};

export const YouTubePanel = ({ settings }: YouTubePanelProps) => {
  const { t } = useTranslation();
  const {
    youtubeLinked,
    botsLoaded,
    botsLoading,
    ytEnabled,
    ytBusy,
    toggleBotIntegration,
    youtubeNeedsRelink,
    youtubeLastRelinkErrorId,
    startStreamerYoutubeAccountRelink,
    youtubeOverrideStatus,
    youtubeOverrideBusy,
    youtubeOverrideLoading,
    preflightAndRedirectToOverrideLink,
    disconnectYoutubeOverride,
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
      {!youtubeLinked ? (
        <div className="glass p-5 sm:p-6 mb-4">
          <div className="font-semibold text-gray-900 dark:text-white">
            {t('settings.accountsServiceYouTubeHint', { defaultValue: 'Нужно привязать YouTube аккаунт в Accounts.' })}
          </div>
          <div className="mt-2">
            <Link to="/settings/accounts" className="underline hover:no-underline text-sm">
              {t('settings.goToAccounts', { defaultValue: 'Привязать аккаунт' })}
            </Link>
          </div>
        </div>
      ) : null}

      {youtubeLinked ? (
        <div className="glass p-5 sm:p-6 mb-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="font-semibold text-gray-900 dark:text-white">
                {t('admin.youtubeOverrideTitle', { defaultValue: 'Свой бот' })}
              </div>
              {isOverrideConnectedButLocked(youtubeOverrideStatus) ? (
                <div className="text-xs text-amber-800 dark:text-amber-200 mt-1">
                  {t('subscription.overrideConnectedButLocked', {
                    defaultValue: 'Бот подключен, но не используется без подписки. Сейчас работает глобальный бот.',
                  })}
                </div>
              ) : null}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <ToggleSwitch
                checked={youtubeOverrideStatus?.enabled === true}
                disabled={youtubeOverrideBusy || youtubeOverrideLoading}
                busy={youtubeOverrideBusy || youtubeOverrideLoading}
                onChange={(next) => {
                  if (next) void preflightAndRedirectToOverrideLink('youtube');
                  else void disconnectYoutubeOverride();
                }}
                ariaLabel={t('admin.youtubeOverrideTitle', { defaultValue: 'Свой бот' })}
              />
            </div>
          </div>
          {isCustomBotConnectLocked ? (
            <div className="mt-2 text-xs text-amber-800 dark:text-amber-200">
              {t('subscription.availableOnlyWithSubscription', { defaultValue: 'по заявкам' })}
            </div>
          ) : null}
        </div>
      ) : null}

      {youtubeLinked ? (
        <div className="glass p-5 sm:p-6 mb-4 relative">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="font-semibold text-gray-900 dark:text-white">YouTube</div>
              <div className="text-sm text-gray-600 dark:text-gray-300 mt-1">
                {t('admin.youtubeBotIntegrationLabel', { defaultValue: 'Включить YouTube-бота для канала.' })}
              </div>
            </div>
            {botsLoading ? <Spinner className="h-5 w-5" /> : null}
            <ToggleSwitch
              checked={ytEnabled}
              disabled={!botsLoaded || botsLoading || ytBusy}
              busy={ytBusy}
              onChange={(next) => void toggleBotIntegration('youtube', next)}
              ariaLabel={t('admin.youtubeBotIntegrationLabel', { defaultValue: 'YouTube bot enabled' })}
            />
          </div>

          {youtubeNeedsRelink && !ytEnabled && (
            <div className="mt-3 rounded-lg bg-amber-50/70 dark:bg-amber-900/20 ring-1 ring-amber-200/60 dark:ring-amber-700/40 px-3 py-2">
              <div className="text-sm text-amber-950 dark:text-amber-100 font-medium">
                {t('admin.youtubeRelinkRequiredNotice', {
                  defaultValue:
                    "Нужно перелинковать YouTube (не хватает прав или токен устарел). Нажмите 'Перелинковать'.",
                })}
              </div>
              {youtubeLastRelinkErrorId ? (
                <div className="mt-1 text-xs text-amber-900/80 dark:text-amber-100/80">
                  {t('common.errorId', { defaultValue: 'Error ID' })}: {youtubeLastRelinkErrorId}
                </div>
              ) : null}
              <div className="mt-2 flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="primary"
                  onClick={() => {
                    startStreamerYoutubeAccountRelink();
                  }}
                >
                  {t('admin.youtubeRelinkStreamerCta', { defaultValue: 'Перепривязать YouTube (аккаунт стримера)' })}
                </Button>
              </div>
            </div>
          )}
        </div>
      ) : null}

      <div className="glass p-5 sm:p-6">
        <div className="font-semibold text-gray-900 dark:text-white">
          {t('admin.botTestMessageTitle', { defaultValue: 'Test message' })}
        </div>
        <div className="text-sm text-gray-600 dark:text-gray-300 mt-1">
          {t('admin.botTestMessageHintYoutube', {
            defaultValue: 'Send a message from the bot into your YouTube live chat. This helps confirm the bot is connected.',
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
              void sendTestMessage('youtube');
            }}
            disabled={sendingTestMessage}
          >
            {t('admin.sendTestMessage', { defaultValue: 'Send test message' })}
          </Button>
          {renderOutboxStatus('youtube')}
          {!ytEnabled && (
            <div className="text-xs text-amber-800 dark:text-amber-200">
              {t('admin.youtubeEnableRequiredToSend', { defaultValue: 'Сначала включите YouTube-бота для канала.' })}
            </div>
          )}
        </div>
      </div>
    </>
  );
};
