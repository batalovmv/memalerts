import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { fetchUser } from '@/store/slices/authSlice';
import { Button, Card } from '@/shared/ui';
import { linkTwitchAccount } from '@/lib/auth';
import { useAuthQueryErrorToast } from '@/shared/auth/useAuthQueryErrorToast';
import type { ExternalAccount } from '@/types';

type ExternalAccountsResponse = { accounts: ExternalAccount[] };

function normalizeAccounts(input: unknown): ExternalAccount[] {
  if (Array.isArray(input)) return input as ExternalAccount[];
  return [];
}

export function AccountsSettings() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const { user } = useAppSelector((s) => s.auth);

  useAuthQueryErrorToast();

  const [loading, setLoading] = useState(false);
  const [unlinkingId, setUnlinkingId] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<ExternalAccount[]>([]);

  const initialFromMe = useMemo(() => normalizeAccounts(user?.externalAccounts), [user?.externalAccounts]);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const { api } = await import('@/lib/api');
      const res = await api.get<ExternalAccountsResponse>('/auth/accounts', { timeout: 15000 });
      setAccounts(Array.isArray(res?.accounts) ? res.accounts : []);
    } catch (error: unknown) {
      // Keep it quiet and show current state; interactions will surface errors.
      const apiError = error as { response?: { data?: { error?: string; message?: string } } };
      const msg = apiError.response?.data?.error || apiError.response?.data?.message;
      if (msg) toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Seed from /me to avoid blank state while fetching.
    if (initialFromMe.length) setAccounts(initialFromMe);
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const linkTwitch = useCallback(() => {
    linkTwitchAccount('/settings/accounts');
  }, []);

  const unlink = useCallback(
    async (externalAccountId: string) => {
      setUnlinkingId(externalAccountId);
      try {
        const { api } = await import('@/lib/api');
        await api.delete(`/auth/accounts/${externalAccountId}`, { timeout: 15000 });
        toast.success(t('settings.accountsUnlinked', { defaultValue: 'Account unlinked.' }));
        await reload();
        // Keep /me in sync for other screens.
        void dispatch(fetchUser());
      } catch (error: unknown) {
        const apiError = error as { response?: { status?: number; data?: { error?: string; message?: string } } };
        const status = apiError.response?.status;
        if (status === 400) {
          toast.error(t('settings.accountsCannotUnlinkLast', { defaultValue: "You can't unlink the last linked account." }));
          return;
        }
        if (status === 404) {
          toast.error(t('settings.accountsNotFound', { defaultValue: "Account not found or doesn't belong to you." }));
          return;
        }
        const msg = apiError.response?.data?.error || apiError.response?.data?.message || t('common.error', { defaultValue: 'Error' });
        toast.error(String(msg));
      } finally {
        setUnlinkingId(null);
      }
    },
    [dispatch, reload, t]
  );

  return (
    <div className="surface p-6">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h2 className="text-2xl font-bold dark:text-white">{t('settings.accountsTitle', { defaultValue: 'Linked accounts' })}</h2>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
            {t('settings.accountsHint', { defaultValue: 'Link an account to sign in and manage Twitch-only features.' })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => void reload()} disabled={loading}>
            {t('common.refresh', { defaultValue: 'Refresh' })}
          </Button>
          <Button variant="primary" onClick={linkTwitch} disabled={loading}>
            {t('settings.linkTwitch', { defaultValue: 'Link Twitch account' })}
          </Button>
        </div>
      </div>

      <div className="space-y-3">
        {accounts.length === 0 ? (
          <Card className="p-5">
            <div className="text-gray-700 dark:text-gray-200 font-semibold">
              {t('settings.noLinkedAccounts', { defaultValue: 'No linked accounts yet.' })}
            </div>
            <div className="text-sm text-gray-600 dark:text-gray-400 mt-1">
              {t('settings.noLinkedAccountsHint', { defaultValue: 'Link at least one account to avoid losing access.' })}
            </div>
          </Card>
        ) : (
          accounts.map((a) => {
            const label =
              a.provider === 'twitch'
                ? `Twitch${a.login ? ` (@${a.login})` : ''}`
                : `${a.provider}${a.login ? ` (${a.login})` : ''}`;
            return (
              <Card key={a.id} className="p-5 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="font-semibold text-gray-900 dark:text-white truncate">{label}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                    {a.displayName ? a.displayName : null}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="danger"
                    onClick={() => void unlink(a.id)}
                    disabled={unlinkingId === a.id || loading}
                  >
                    {unlinkingId === a.id
                      ? t('common.loading', { defaultValue: 'Loading' })
                      : t('settings.unlink', { defaultValue: 'Unlink' })}
                  </Button>
                </div>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}


