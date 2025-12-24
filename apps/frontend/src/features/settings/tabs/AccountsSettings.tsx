import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppSelector } from '@/store/hooks';
import { Button, Card } from '@/shared/ui';
import { linkTwitchAccount } from '@/lib/auth';
import { useAuthQueryErrorToast } from '@/shared/auth/useAuthQueryErrorToast';
import type { ExternalAccount } from '@/types';

function normalizeAccounts(input: unknown): ExternalAccount[] {
  if (Array.isArray(input)) return input as ExternalAccount[];
  return [];
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5" aria-hidden="true">
      <path
        fillRule="evenodd"
        d="M16.704 5.29a1 1 0 0 1 .007 1.414l-7.5 7.6a1 1 0 0 1-1.42.004l-3.5-3.5a1 1 0 1 1 1.414-1.414l2.79 2.79 6.792-6.884a1 1 0 0 1 1.417-.01Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

export function AccountsSettings() {
  const { t } = useTranslation();
  const { user } = useAppSelector((s) => s.auth);

  useAuthQueryErrorToast();

  const accounts = useMemo(() => normalizeAccounts(user?.externalAccounts), [user?.externalAccounts]);
  const linkedProviders = useMemo(() => new Set(accounts.map((a) => a.provider)), [accounts]);

  const linkTwitch = useCallback(() => {
    linkTwitchAccount('/settings/accounts');
  }, []);

  const services = useMemo(
    () =>
      [
        {
          provider: 'twitch' as const,
          title: t('settings.accountsServiceTwitch', { defaultValue: 'Twitch' }),
          description: t('settings.accountsServiceTwitchHint', {
            defaultValue: 'Used to sign in and enable Twitch-only features.',
          }),
          onLink: linkTwitch,
        },
      ] as const,
    [linkTwitch, t]
  );

  return (
    <div className="surface p-6">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h2 className="text-2xl font-bold dark:text-white">{t('settings.accountsTitle', { defaultValue: 'Linked accounts' })}</h2>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
            {t('settings.accountsHint', {
              defaultValue: 'Connect services to sign in and enable integrations.',
            })}
          </p>
        </div>
      </div>

      <div className="space-y-3">
        {services.map((service) => {
          const isLinked = linkedProviders.has(service.provider);
          const linkedAccount = accounts.find((a) => a.provider === service.provider) as ExternalAccount | undefined;
          return (
            <Card key={service.provider} className="p-5 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="font-semibold text-gray-900 dark:text-white truncate">{service.title}</div>
                  {isLinked ? (
                    <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400 text-sm font-semibold">
                      <CheckIcon />
                      {t('settings.accountsLinked', { defaultValue: 'Connected' })}
                    </span>
                  ) : (
                    <span className="text-sm text-gray-500 dark:text-gray-400">
                      {t('settings.accountsNotLinked', { defaultValue: 'Not connected' })}
                    </span>
                  )}
                </div>
                <div className="text-sm text-gray-600 dark:text-gray-400 mt-1 truncate">
                  {isLinked && linkedAccount?.login ? `@${linkedAccount.login}` : service.description}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {!isLinked ? (
                  <Button variant="primary" onClick={service.onLink}>
                    {t('settings.accountsLinkAction', { defaultValue: 'Connect' })}
                  </Button>
                ) : null}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}


