import { useTranslation } from 'react-i18next';

import { ToggleSwitch } from '../../components/ToggleSwitch';
import type { UseBotCommandsResult } from '../../hooks/useBotCommands';

import { Button, Input } from '@/shared/ui';
import { SavingOverlay } from '@/shared/ui/StatusOverlays';

type TwitchLegacyCommandsProps = {
  commands: UseBotCommandsResult;
  showMenus: boolean;
};

export const TwitchLegacyCommands = ({ commands, showMenus }: TwitchLegacyCommandsProps) => {
  const { t } = useTranslation();
  const {
    commandsNotAvailable,
    commandsOpen,
    setCommandsOpen,
    commandsOnlyWhenLive,
    commandToggleLoadingId,
    commandsLoading,
    savingCommandsBulk,
    visibleCommands,
    anyCommandEnabled,
    newTrigger,
    setNewTrigger,
    newResponse,
    setNewResponse,
    newAllowedRoles,
    setNewAllowedRoles,
    newAllowedUsers,
    setNewAllowedUsers,
    editingAudienceId,
    setEditingAudienceId,
    audienceDraftRoles,
    setAudienceDraftRoles,
    audienceDraftUsers,
    setAudienceDraftUsers,
    normalizeUserList,
    formatUserList,
    addCommand,
    updateCommand,
    deleteCommand,
    toggleAllCommands,
    toggleCommandsOnlyWhenLive,
  } = commands;

  return (
    <div className="rounded-xl bg-white/40 dark:bg-white/5 ring-1 ring-black/5 dark:ring-white/10 p-4 relative">
      {savingCommandsBulk ? <SavingOverlay label={t('admin.saving', { defaultValue: 'Saving:' })} /> : null}
      <div className="flex items-start justify-between gap-4">
        <button
          type="button"
          className={`min-w-0 text-left rounded-lg -m-1 p-1 transition-colors ${
            showMenus ? 'hover:bg-white/40 dark:hover:bg-white/5' : 'opacity-60 cursor-not-allowed'
          }`}
          disabled={!showMenus}
          onClick={() => setCommandsOpen((v) => !v)}
        >
          <div className="font-semibold text-gray-900 dark:text-white">
            {t('admin.botCommandsTitle', { defaultValue: 'Команды' })}
          </div>
          <div className="text-sm text-gray-600 dark:text-gray-300 mt-1">
            {t('admin.botCommandsHint', {
              defaultValue:
                'Create a trigger word and the bot reply. When someone sends the trigger in chat, the bot will respond.',
            })}
          </div>
        </button>

        <div className="flex items-center gap-3 shrink-0">
          <svg
            className={`w-4 h-4 text-gray-600 dark:text-gray-300 transition-transform ${commandsOpen ? 'rotate-180' : ''}`}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
          <ToggleSwitch
            checked={anyCommandEnabled}
            disabled={savingCommandsBulk || commandToggleLoadingId !== null || commandsLoading || commandsNotAvailable}
            busy={savingCommandsBulk}
            onChange={(next) => void toggleAllCommands(next)}
            ariaLabel={t('admin.botCommandsMasterTitle', { defaultValue: 'Commands enabled' })}
          />
        </div>
      </div>

      {commandsNotAvailable && (
        <div className="mt-3 text-sm text-amber-800 dark:text-amber-200">
          {t('admin.botCommandsNotAvailable', {
            defaultValue: 'Commands are not available on this server yet. Please deploy the backend update.',
          })}
        </div>
      )}

      {!commandsNotAvailable && commandsOpen && (
        <>
          <div className="mt-3 flex items-start justify-between gap-4 rounded-lg bg-white/40 dark:bg-white/5 ring-1 ring-black/5 dark:ring-white/10 px-3 py-2">
            <div className="min-w-0">
              <div className="text-xs font-semibold text-gray-700 dark:text-gray-200">
                {t('admin.botCommandsOnlyWhenLiveTitle', { defaultValue: 'Active only when stream is live' })}
              </div>
              <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                {t('admin.botCommandsOnlyWhenLiveHint', {
                  defaultValue: 'If enabled, all bot commands reply only while your stream is online.',
                })}
              </div>
            </div>
            <ToggleSwitch
              checked={commandsOnlyWhenLive}
              onChange={(next) => void toggleCommandsOnlyWhenLive(next)}
              disabled={commandsLoading || savingCommandsBulk || commandToggleLoadingId !== null || visibleCommands.length === 0}
              busy={savingCommandsBulk}
              ariaLabel={t('admin.botCommandsOnlyWhenLiveTitle', { defaultValue: 'Active only when stream is live' })}
            />
          </div>

          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-200 mb-1">
                {t('admin.botCommandTrigger', { defaultValue: 'Trigger' })}
              </label>
              <Input value={newTrigger} onChange={(e) => setNewTrigger(e.target.value)} placeholder="!hello" disabled={commandsLoading} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-200 mb-1">
                {t('admin.botCommandResponse', { defaultValue: 'Response' })}
              </label>
              <Input value={newResponse} onChange={(e) => setNewResponse(e.target.value)} placeholder="Hi chat!" disabled={commandsLoading} />
            </div>
          </div>

          <div className="mt-3 rounded-lg bg-white/40 dark:bg-white/5 ring-1 ring-black/5 dark:ring-white/10 px-3 py-2">
            <div className="text-xs font-semibold text-gray-700 dark:text-gray-200">
              {t('admin.botCommandAudienceTitle', { defaultValue: 'Who can trigger' })}
            </div>
            <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
              {t('admin.botCommandAudienceHint', {
                defaultValue:
                  'Choose roles and/or specific users. Leave empty to allow everyone. Note: the broadcaster (streamer) may always be allowed to run commands even if their role is not selected.',
              })}
            </div>

            <div className="mt-2 flex flex-wrap gap-3">
              {(['vip', 'moderator', 'subscriber', 'follower'] as const).map((role) => {
                const checked = newAllowedRoles.includes(role);
                return (
                  <label key={role} className="inline-flex items-center gap-2 text-xs text-gray-700 dark:text-gray-200">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        const next = e.target.checked;
                        setNewAllowedRoles((prev) => (next ? [...prev, role] : prev.filter((r) => r !== role)));
                      }}
                      disabled={commandsLoading}
                      className="h-4 w-4 rounded border-white/20 dark:border-white/10 bg-white/60 dark:bg-white/10"
                    />
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

            <div className="mt-2">
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-200 mb-1">
                {t('admin.botCommandAudienceUsersLabel', { defaultValue: 'Specific users (logins)' })}
              </label>
              <Input
                value={newAllowedUsers}
                onChange={(e) => setNewAllowedUsers(e.target.value)}
                placeholder={t('admin.botCommandAudienceUsersPlaceholder', { defaultValue: 'e.g. lotas_bro, someuser' })}
                disabled={commandsLoading}
              />
              <div className="mt-1 text-[11px] text-gray-600 dark:text-gray-300">
                {t('admin.botCommandAudienceUsersHint', { defaultValue: 'Comma/space separated. "@" is allowed.' })}
              </div>
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
                      <div className="mt-1 text-[11px] text-gray-600 dark:text-gray-300">
                        {t('admin.botCommandAudienceSummary', { defaultValue: 'Audience' })}:{' '}
                        {(() => {
                          const roles = Array.isArray(cmd.allowedRoles) ? cmd.allowedRoles : [];
                          const users = Array.isArray(cmd.allowedUsers) ? cmd.allowedUsers : [];
                          if (roles.length === 0 && users.length === 0) {
                            return t('admin.botCommandAudienceEveryone', { defaultValue: 'Everyone' });
                          }
                          const parts: string[] = [];
                          if (roles.length) {
                            parts.push(
                              roles
                                .map((r) =>
                                  t(`admin.botRole_${r}`, {
                                    defaultValue:
                                      r === 'vip'
                                        ? 'VIP'
                                        : r === 'moderator'
                                          ? 'Moderators'
                                          : r === 'subscriber'
                                            ? 'Subscribers'
                                            : 'Followers',
                                  })
                                )
                                .join(', ')
                            );
                          }
                          if (users.length) {
                            parts.push(users.map((u) => `@${u}`).join(', '));
                          }
                          return parts.join(' • ');
                        })()}
                      </div>

                      <div className="mt-2">
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() => {
                            if (editingAudienceId === cmd.id) {
                              setEditingAudienceId(null);
                              return;
                            }
                            setEditingAudienceId(cmd.id);
                            setAudienceDraftRoles(Array.isArray(cmd.allowedRoles) ? cmd.allowedRoles : []);
                            setAudienceDraftUsers(formatUserList(cmd.allowedUsers));
                          }}
                          disabled={commandToggleLoadingId === cmd.id || savingCommandsBulk}
                        >
                          {editingAudienceId === cmd.id
                            ? t('common.close', { defaultValue: 'Close' })
                            : t('admin.editAudience', { defaultValue: 'Audience' })}
                        </Button>
                      </div>

                      {editingAudienceId === cmd.id && (
                        <div className="mt-2 rounded-lg bg-white/40 dark:bg-white/5 ring-1 ring-black/5 dark:ring-white/10 px-3 py-2">
                          <div className="text-xs font-semibold text-gray-700 dark:text-gray-200">
                            {t('admin.botCommandAudienceTitle', { defaultValue: 'Who can trigger' })}
                          </div>
                          <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                            {t('admin.botCommandAudienceHint', {
                              defaultValue:
                                'Choose roles and/or specific users. Leave empty to allow everyone. Note: the broadcaster (streamer) may always be allowed to run commands even if their role is not selected.',
                            })}
                          </div>

                          <div className="mt-2 flex flex-wrap gap-3">
                            {(['vip', 'moderator', 'subscriber', 'follower'] as const).map((role) => {
                              const checked = audienceDraftRoles.includes(role);
                              return (
                                <label key={role} className="inline-flex items-center gap-2 text-xs text-gray-700 dark:text-gray-200">
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={(e) => {
                                      const next = e.target.checked;
                                      setAudienceDraftRoles((prev) => (next ? [...prev, role] : prev.filter((r) => r !== role)));
                                    }}
                                    disabled={commandToggleLoadingId === cmd.id}
                                    className="h-4 w-4 rounded border-white/20 dark:border-white/10 bg-white/60 dark:bg-white/10"
                                  />
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

                          <div className="mt-2">
                            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-200 mb-1">
                              {t('admin.botCommandAudienceUsersLabel', { defaultValue: 'Specific users (logins)' })}
                            </label>
                            <Input
                              value={audienceDraftUsers}
                              onChange={(e) => setAudienceDraftUsers(e.target.value)}
                              placeholder={t('admin.botCommandAudienceUsersPlaceholder', { defaultValue: 'e.g. lotas_bro, someuser' })}
                              disabled={commandToggleLoadingId === cmd.id}
                            />
                            <div className="mt-1 text-[11px] text-gray-600 dark:text-gray-300">
                              {t('admin.botCommandAudienceUsersHint', { defaultValue: 'Comma/space separated. "@" is allowed.' })}
                            </div>
                          </div>

                          <div className="mt-3 flex items-center justify-end gap-2">
                            <Button
                              type="button"
                              variant="secondary"
                              onClick={() => {
                                setEditingAudienceId(null);
                                setAudienceDraftRoles([]);
                                setAudienceDraftUsers('');
                              }}
                              disabled={commandToggleLoadingId === cmd.id}
                            >
                              {t('common.cancel', { defaultValue: 'Cancel' })}
                            </Button>
                            <Button
                              type="button"
                              variant="primary"
                              onClick={() => {
                                const allowedUsers = normalizeUserList(audienceDraftUsers);
                                void updateCommand(cmd.id, { allowedRoles: audienceDraftRoles, allowedUsers });
                              }}
                              disabled={commandToggleLoadingId === cmd.id}
                            >
                              {t('common.save', { defaultValue: 'Save' })}
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <div className="flex flex-col items-end gap-1">
                        <div className="flex items-center gap-2">
                          <div className="text-[10px] text-gray-600 dark:text-gray-300 whitespace-nowrap">
                            {t('admin.botCommandEnabledLabel', { defaultValue: 'Enabled' })}
                          </div>
                          <ToggleSwitch
                            checked={cmd.enabled !== false}
                            disabled={commandToggleLoadingId !== null || savingCommandsBulk}
                            busy={commandToggleLoadingId === cmd.id}
                            onChange={(next) => void updateCommand(cmd.id, { enabled: next })}
                            ariaLabel={t('admin.botCommandEnabledLabel', { defaultValue: 'Enabled' })}
                          />
                        </div>
                      </div>
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => void deleteCommand(cmd.id)}
                        disabled={commandToggleLoadingId === cmd.id}
                      >
                        {t('common.delete', { defaultValue: 'Delete' })}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {!commandsNotAvailable && !commandsOpen && (
        <div className="mt-3 text-sm text-gray-600 dark:text-gray-300">
          {t('admin.botCommandsDisabledHint', { defaultValue: 'Enable commands to manage triggers and replies.' })}
        </div>
      )}
    </div>
  );
};
