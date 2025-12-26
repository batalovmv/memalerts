import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { api } from '@/lib/api';
import { Button, Pill, Spinner } from '@/shared/ui';
import { useAppSelector } from '@/store/hooks';

export function BetaAccessSelf() {
  const { t } = useTranslation();
  const { user } = useAppSelector((s) => s.auth);
  const [loading, setLoading] = useState(true);
  const [requesting, setRequesting] = useState(false);
  const [status, setStatus] = useState<{ hasAccess: boolean; request: { status: string } | null } | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const res = await api.get<{ hasAccess: boolean; request: { status: string } | null }>('/beta/status', { timeout: 10000 });
      setStatus(res);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  const request = async () => {
    setRequesting(true);
    try {
      await api.post('/beta/request');
      await load();
    } finally {
      setRequesting(false);
    }
  };

  const requestStatus = status?.request?.status;

  return (
    <section className="space-y-4">
      <h2 className="text-2xl font-bold dark:text-white">{t('admin.betaAccess')}</h2>
      <p className="mt-2 text-gray-700 dark:text-gray-200">
        {t('betaAccess.pageDescription', { defaultValue: 'Beta is for testing new features. You can request access below.' })}
      </p>

      {loading ? (
        <div className="mt-6 flex items-center gap-3 text-gray-600 dark:text-gray-300">
          <Spinner className="h-5 w-5" />
          <span className="text-sm font-semibold">{t('common.loading', { defaultValue: 'Loading…' })}</span>
        </div>
      ) : status?.hasAccess ? (
        <div className="mt-6 glass p-4 flex items-center gap-3 text-gray-900 dark:text-white">
          <Pill variant="successSolid" className="w-6 h-6 p-0 shadow" title={t('betaAccess.statusApproved', { defaultValue: 'approved' })}>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
            </svg>
          </Pill>
          <div className="font-semibold">{t('betaAccess.hasAccess', { defaultValue: 'You already have beta access.' })}</div>
        </div>
      ) : requestStatus === 'pending' ? (
        <div className="mt-6 glass p-4 text-gray-900 dark:text-white">
          <div className="font-semibold">{t('betaAccess.pending')}</div>
        </div>
      ) : requestStatus === 'revoked' ? (
        <div className="mt-6 glass p-4 text-gray-900 dark:text-white">
          <div className="font-semibold">{t('betaAccess.blacklistedTitle', { defaultValue: 'Access denied' })}</div>
          <div className="mt-1 text-sm text-gray-700 dark:text-gray-200">
            {t('betaAccess.blacklistedDescription', { defaultValue: 'Sorry, you cannot get beta access because you are on the blacklist.' })}
          </div>
        </div>
      ) : (
        <div className="mt-6 glass p-4">
          <Button type="button" variant="secondary" onClick={request} disabled={requesting}>
            {requesting ? (
              <span className="inline-flex items-center gap-2">
                <Spinner className="h-4 w-4" />
                {t('common.loading', { defaultValue: 'Loading…' })}
              </span>
            ) : (
              t('betaAccess.requestButton')
            )}
          </Button>
        </div>
      )}
    </section>
  );
}


