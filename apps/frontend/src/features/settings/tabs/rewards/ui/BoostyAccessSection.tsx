import { useTranslation } from 'react-i18next';

import type { BoostyAccessResponse } from '@/features/settings/tabs/rewards/utils';

import { SettingsSection } from '@/features/settings/ui/SettingsSection';
import { Button } from '@/shared/ui';

type BoostyAccessSectionProps = {
  effectiveChannelId: string | null;
  boostyAccess: BoostyAccessResponse | null;
  boostyAccessLoading: boolean;
  boostyAccessError: string | null;
  boostyAccessNeedsAuth: boolean;
  onRefresh: () => void;
  onStartLogin: () => void;
  onLinkDiscord: () => void;
};

export function BoostyAccessSection({
  effectiveChannelId,
  boostyAccess,
  boostyAccessLoading,
  boostyAccessError,
  boostyAccessNeedsAuth,
  onRefresh,
  onStartLogin,
  onLinkDiscord,
}: BoostyAccessSectionProps) {
  const { t } = useTranslation();

  return (
    <SettingsSection
      title={t('subscription.boostyAccessTitle', { defaultValue: 'Подписка / Boosty rewards' })}
      description={t('subscription.boostyAccessDescription', {
        defaultValue: 'Статус доступа определяется через Discord roles. Никаких Boosty-токенов больше не нужно.',
      })}
      right={
        <Button type="button" variant="secondary" onClick={onRefresh} disabled={boostyAccessLoading}>
          {boostyAccessLoading ? t('common.loading', { defaultValue: 'Loading…' }) : t('common.refresh', { defaultValue: 'Проверить снова' })}
        </Button>
      }
    >
      {!effectiveChannelId ? (
        <div className="text-sm text-gray-600 dark:text-gray-300">
          {t('subscription.boostyAccessNoChannel', { defaultValue: 'Не удалось определить channelId.' })}
        </div>
      ) : boostyAccess ? (
        <div className="space-y-3">
          <div className="text-sm text-gray-700 dark:text-gray-200">
            {t('subscription.boostyAccessRequiredGuild', { defaultValue: 'Discord сервер (guildId)' })}:{' '}
            <span className="font-mono">{boostyAccess.requiredGuild.guildId}</span>
            {boostyAccess.requiredGuild.name ? (
              <span className="ml-2 text-gray-500 dark:text-gray-400">({boostyAccess.requiredGuild.name})</span>
            ) : null}
          </div>

          {boostyAccess.status === 'need_discord_link' ? (
            <div className="rounded-xl bg-white/40 dark:bg-white/5 ring-1 ring-black/5 dark:ring-white/10 p-4">
              <div className="font-semibold text-gray-900 dark:text-white">
                {t('subscription.boostyAccessNeedDiscordTitle', { defaultValue: 'Нужно привязать Discord' })}
              </div>
              <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                {t('subscription.boostyAccessNeedDiscordBody', { defaultValue: 'Привяжите Discord, затем мы проверим роли на сервере.' })}
              </div>
              <div className="mt-3">
                <Button type="button" variant="primary" onClick={onLinkDiscord}>
                  {t('subscription.boostyAccessLinkDiscordCta', { defaultValue: 'Привязать Discord' })}
                </Button>
              </div>
            </div>
          ) : null}

          {boostyAccess.status === 'need_join_guild' ? (
            <div className="rounded-xl bg-white/40 dark:bg-white/5 ring-1 ring-black/5 dark:ring-white/10 p-4">
              <div className="font-semibold text-gray-900 dark:text-white">
                {t('subscription.boostyAccessNeedJoinTitle', { defaultValue: 'Нужно быть на Discord‑сервере' })}
              </div>
              <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                {boostyAccess.requiredGuild.autoJoin
                  ? t('subscription.boostyAccessAutoJoinHint', {
                      defaultValue:
                        'После привязки Discord мы попробуем добавить вас автоматически. Если не получилось — вступите по инвайту.',
                    })
                  : t('subscription.boostyAccessManualJoinHint', {
                      defaultValue: 'Вступите на сервер и нажмите “Проверить снова”.',
                    })}
              </div>
              {boostyAccess.requiredGuild.inviteUrl ? (
                <div className="mt-3 flex items-center gap-2">
                  <a href={boostyAccess.requiredGuild.inviteUrl} target="_blank" rel="noreferrer">
                    <Button type="button" variant="secondary">
                      {t('subscription.boostyAccessJoinCta', { defaultValue: 'Вступить' })}
                    </Button>
                  </a>
                </div>
              ) : (
                <div className="mt-3 text-sm text-gray-600 dark:text-gray-300">
                  {t('subscription.boostyAccessNoInvite', {
                    defaultValue: 'Инвайт пока недоступен. Попросите ссылку у стримера/на сайте и затем нажмите “Проверить снова”.',
                  })}
                </div>
              )}
            </div>
          ) : null}

          {boostyAccess.status === 'not_subscribed' ? (
            <div className="rounded-xl bg-white/40 dark:bg-white/5 ring-1 ring-black/5 dark:ring-white/10 p-4">
              <div className="font-semibold text-gray-900 dark:text-white">
                {t('subscription.boostyAccessNotSubscribedTitle', { defaultValue: 'Подписка не найдена' })}
              </div>
              <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                {t('subscription.boostyAccessNotSubscribedBody', {
                  defaultValue: 'Проверьте, что вы подключили Discord в Boosty и что Boosty выдал роль на сервере.',
                })}
              </div>
            </div>
          ) : null}

          {boostyAccess.status === 'subscribed' ? (
            <div className="rounded-xl bg-emerald-500/10 ring-1 ring-emerald-500/20 p-4">
              <div className="font-semibold text-emerald-900 dark:text-emerald-100">
                {t('subscription.boostyAccessSubscribedTitle', { defaultValue: 'Подписка активна' })}
              </div>
              {boostyAccess.matchedTier ? (
                <div className="mt-1 text-sm text-emerald-900/80 dark:text-emerald-100/80">
                  {t('subscription.boostyAccessTier', { defaultValue: 'Tier' })}: <span className="font-mono">{boostyAccess.matchedTier}</span>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : boostyAccessError ? (
        <div className="text-sm text-red-600 dark:text-red-400">
          <div>{boostyAccessError}</div>
          {boostyAccessNeedsAuth ? (
            <div className="mt-3">
              <Button type="button" variant="secondary" onClick={onStartLogin}>
                {t('auth.signIn', { defaultValue: 'Sign in' })}
              </Button>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="text-sm text-gray-600 dark:text-gray-300">
          {t('common.loading', { defaultValue: 'Loading…' })}
        </div>
      )}
    </SettingsSection>
  );
}
