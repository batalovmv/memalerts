import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { HelpTooltip } from '@/shared/ui';
import { SavingOverlay } from '@/shared/ui/StatusOverlays';

import { ToggleSwitch } from '../../components/ToggleSwitch';
import type { UseBotCommandsResult } from '../../hooks/useBotCommands';
import type { UseBotSettingsResult } from '../../hooks/useBotSettings';
import { TwitchLegacyMenus } from './TwitchLegacyMenus';

type TwitchPanelProps = {
  settings: UseBotSettingsResult;
  commands: UseBotCommandsResult;
};

export const TwitchPanel = ({ settings, commands }: TwitchPanelProps) => {
  const { t } = useTranslation();
  const {
    twitchLinked,
    twitchOverrideStatus,
    twitchOverrideBusy,
    twitchOverrideLoading,
    isOverrideConnectedButLocked,
    isCustomBotConnectLocked,
    preflightAndRedirectToOverrideLink,
    disconnectTwitchOverride,
    botEnabled,
    statusLoaded,
    loading,
    callToggle,
    isBusy,
    showMenus,
    menusDisabled,
    twitchBotNotConfiguredHint,
  } = settings;

  return (
    <>
      {!twitchLinked ? (
        <div className="glass p-5 sm:p-6 mb-4">
          <div className="font-semibold text-gray-900 dark:text-white">
            {t('admin.twitchChannelNotLinked', { defaultValue: 'This channel is not linked to Twitch.' })}
          </div>
          <div className="mt-2">
            <Link to="/settings/accounts" className="underline hover:no-underline text-sm">
              {t('settings.goToAccounts', { defaultValue: 'Привязать аккаунт' })}
            </Link>
          </div>
        </div>
      ) : null}

      {twitchLinked ? (
        <div className="glass p-5 sm:p-6 mb-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="font-semibold text-gray-900 dark:text-white">
                {t('admin.twitchOverrideTitle', { defaultValue: 'Свой бот' })}
              </div>
              {isOverrideConnectedButLocked(twitchOverrideStatus) ? (
                <div className="text-xs text-amber-800 dark:text-amber-200 mt-1">
                  {t('subscription.overrideConnectedButLocked', {
                    defaultValue: 'Бот подключен, но не используется без подписки. Сейчас работает глобальный бот.',
                  })}
                </div>
              ) : null}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <HelpTooltip
                content={t('help.settings.bot.override', {
                  defaultValue:
                    'Use your own bot account instead of the default one. If you turn it on, you will be redirected to connect.',
                })}
              >
                <div>
                  <ToggleSwitch
                    checked={twitchOverrideStatus?.enabled === true}
                    disabled={twitchOverrideBusy || twitchOverrideLoading}
                    busy={twitchOverrideBusy || twitchOverrideLoading}
                    onChange={(next) => {
                      if (next) void preflightAndRedirectToOverrideLink('twitch');
                      else void disconnectTwitchOverride();
                    }}
                    ariaLabel={t('admin.twitchOverrideTitle', { defaultValue: 'Свой бот' })}
                  />
                </div>
              </HelpTooltip>
            </div>
          </div>
          {isCustomBotConnectLocked ? (
            <div className="mt-2 text-xs text-amber-800 dark:text-amber-200">
              {t('subscription.availableOnlyWithSubscription', { defaultValue: 'по заявкам' })}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className={`glass p-5 sm:p-6 relative ${isBusy ? 'pointer-events-none opacity-60' : ''}`}>
        {loading === 'toggle' ? <SavingOverlay label={t('admin.saving', { defaultValue: 'Saving:' })} /> : null}
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="font-semibold text-gray-900 dark:text-white">
              {t('admin.botToggleTitle', { defaultValue: 'Chat bot' })}
            </div>
            <div className="text-sm text-gray-600 dark:text-gray-300 mt-1">
              {t('admin.botToggleHint', { defaultValue: 'When enabled, the runner will join your chat.' })}
            </div>
          </div>
          <HelpTooltip
            content={t('help.settings.bot.enable', {
              defaultValue: 'Turn the bot on/off for this channel. When on, it can respond in chat.',
            })}
          >
            <div>
              <ToggleSwitch
                checked={botEnabled ?? false}
                onChange={(next) => void callToggle(next)}
                disabled={isBusy || !statusLoaded || !twitchLinked}
                busy={loading === 'toggle'}
                ariaLabel={t('admin.botToggleTitle', { defaultValue: 'Chat bot' })}
              />
            </div>
          </HelpTooltip>
        </div>

        {!twitchLinked && (
          <div className="mt-2 text-xs text-yellow-700 dark:text-yellow-300">
            {t('admin.twitchChannelNotLinked', { defaultValue: 'This channel is not linked to Twitch.' })}
          </div>
        )}

        {twitchBotNotConfiguredHint && (
          <div className="mt-2 text-xs text-amber-800 dark:text-amber-200">
            {t('admin.twitchBotNotConfiguredHint', {
              defaultValue: 'Нужен отправитель сообщений: подключите своего бота или попросите админа подключить дефолтного.',
            })}
          </div>
        )}

        {!statusLoaded && (
          <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
            {loading === 'load'
              ? t('admin.botStatusLoading', { defaultValue: 'Loading status:' })
              : t('admin.botStatusUnknown', { defaultValue: 'Status is unknown.' })}
          </div>
        )}

        <TwitchLegacyMenus settings={settings} commands={commands} showMenus={showMenus} menusDisabled={menusDisabled} />
      </div>

      {false && (
        <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
          {t('admin.botMenusDisabledHint', { defaultValue: 'Enable the bot to access its settings.' })}
        </div>
      )}
    </>
  );
};
