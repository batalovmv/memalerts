import { useTranslation } from 'react-i18next';

import { SavingOverlay } from '@/shared/ui/StatusOverlays';
import { Button, HelpTooltip, Input } from '@/shared/ui';

import { ToggleSwitch } from '../components/ToggleSwitch';
import type { UseBotCommandsResult } from '../hooks/useBotCommands';

type CommandsSectionProps = {
  commands: UseBotCommandsResult;
};

export const CommandsSection = ({ commands }: CommandsSectionProps) => {
  const { t } = useTranslation();
  const {
    commandsLoading,
    commandsNotAvailable,
    commandToggleLoadingId,
    commandsOpen,
    setCommandsOpen,
    newTrigger,
    setNewTrigger,
    newResponse,
    setNewResponse,
    newAllowedRoles,
    newAllowedUsers,
    savingCommandsBulk,
    visibleCommands,
    anyCommandEnabled,
    addCommand,
    updateCommand,
    toggleAllCommands,
  } = commands;

  return (
    <div className="rounded-xl bg-white/40 dark:bg-white/5 ring-1 ring-black/5 dark:ring-white/10 p-4 relative">
      {savingCommandsBulk ? <SavingOverlay label={t('admin.saving', { defaultValue: 'Saving:' })} /> : null}
      <div className="flex items-start justify-between gap-4">
        <button
          type="button"
          className="min-w-0 text-left rounded-lg -m-1 p-1 transition-colors hover:bg-white/40 dark:hover:bg-white/5"
          onClick={() => setCommandsOpen((v) => !v)}
        >
          <div className="font-semibold text-gray-900 dark:text-white">
            {t('admin.botCommandsTitle', { defaultValue: 'Команды' })}
          </div>
          <div className="text-sm text-gray-600 dark:text-gray-300 mt-1">
            {t('admin.botCommandsHint', {
              defaultValue: 'Create a trigger word and the bot reply.',
            })}
          </div>
        </button>
        <div className="flex items-center gap-3 shrink-0">
          <HelpTooltip
            content={t('help.settings.bot.commandsMaster', {
              defaultValue: 'Master switch for all bot commands. Turn off to silence all commands at once.',
            })}
          >
            <div>
              <ToggleSwitch
                checked={anyCommandEnabled}
                disabled={savingCommandsBulk || commandToggleLoadingId !== null || commandsLoading || commandsNotAvailable}
                busy={savingCommandsBulk}
                onChange={(next) => void toggleAllCommands(next)}
                ariaLabel={t('admin.botCommandsMasterTitle', { defaultValue: 'Commands enabled' })}
              />
            </div>
          </HelpTooltip>
        </div>
      </div>

      {commandsOpen && (
        <>
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-200 mb-1">
                {t('admin.botCommandTrigger', { defaultValue: 'Trigger' })}
              </label>
              <Input
                value={newTrigger}
                onChange={(e) => setNewTrigger(e.target.value)}
                placeholder="!hello"
                disabled={commandsLoading}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-200 mb-1">
                {t('admin.botCommandResponse', { defaultValue: 'Response' })}
              </label>
              <Input
                value={newResponse}
                onChange={(e) => setNewResponse(e.target.value)}
                placeholder="Hi chat!"
                disabled={commandsLoading}
              />
            </div>
          </div>

          <div className="mt-3 rounded-lg bg-white/40 dark:bg-white/5 ring-1 ring-black/5 dark:ring-white/10 px-3 py-2">
            <div className="text-xs font-semibold text-gray-700 dark:text-gray-200">
              {t('admin.botCommandAudienceTitle', { defaultValue: 'Who can trigger' })}
              <span className="ml-2 text-[11px] font-semibold text-amber-800 dark:text-amber-200">
                {t('subscription.availableOnlyWithSubscription', { defaultValue: 'в разработке' })}
              </span>
            </div>
            <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
              {t('admin.botCommandAudienceHint', {
                defaultValue: 'Выбор ролей и пользователей временно недоступен. Сейчас команда доступна всем.',
              })}
            </div>

            <div className="mt-2 flex flex-wrap gap-3 opacity-70 pointer-events-none">
              {(['vip', 'moderator', 'subscriber', 'follower'] as const).map((role) => {
                const checked = newAllowedRoles.includes(role);
                return (
                  <label key={role} className="inline-flex items-center gap-2 text-xs text-gray-700 dark:text-gray-200">
                    <input type="checkbox" checked={checked} readOnly />
                    <span>
                      {t(`admin.botRole_${role}`, {
                        defaultValue:
                          role === 'vip'
                            ? 'VIP'
                            : role === 'moderator'
                              ? 'Moderators'
                              : role === 'subscriber'
                                ? 'Subscribers'
                                : 'Followers',
                      })}
                    </span>
                  </label>
                );
              })}
            </div>

            <div className="mt-2 opacity-70 pointer-events-none">
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-200 mb-1">
                {t('admin.botCommandAudienceUsersLabel', { defaultValue: 'Specific users (logins)' })}
              </label>
              <Input value={newAllowedUsers} onChange={() => {}} placeholder="e.g. lotas_bro" disabled />
            </div>
          </div>

          <div className="mt-3 flex items-center justify-between gap-3">
            <Button
              type="button"
              variant="primary"
              onClick={() => void addCommand()}
              disabled={commandsLoading || !newTrigger.trim() || !newResponse.trim()}
            >
              {t('admin.addBotCommand', { defaultValue: 'Add command' })}
            </Button>
          </div>
          <div className="mt-3">
            {commandsLoading ? (
              <div className="text-xs text-gray-500 dark:text-gray-400">{t('common.loading', { defaultValue: 'Loading:' })}</div>
            ) : visibleCommands.length === 0 ? (
              <div className="text-sm text-gray-600 dark:text-gray-300">
                {t('admin.noBotCommands', { defaultValue: 'No commands yet.' })}
              </div>
            ) : (
              <div className="space-y-2">
                {visibleCommands.map((cmd) => (
                  <div
                    key={cmd.id}
                    className="flex items-start justify-between gap-3 rounded-lg bg-white/50 dark:bg-white/5 ring-1 ring-black/5 dark:ring-white/10 px-3 py-2 relative"
                  >
                    {commandToggleLoadingId === cmd.id ? <SavingOverlay label={t('admin.saving', { defaultValue: 'Saving:' })} /> : null}
                    <div className="min-w-0">
                      <div className="font-mono text-sm text-gray-900 dark:text-white truncate">{cmd.trigger}</div>
                      <div className="text-sm text-gray-700 dark:text-gray-200 break-words">{cmd.response}</div>
                    </div>
                    <ToggleSwitch
                      checked={cmd.enabled !== false}
                      disabled={commandToggleLoadingId !== null || savingCommandsBulk}
                      busy={commandToggleLoadingId === cmd.id}
                      onChange={(next) => void updateCommand(cmd.id, { enabled: next })}
                      ariaLabel={t('admin.botCommandEnabledLabel', { defaultValue: 'Enabled' })}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};
