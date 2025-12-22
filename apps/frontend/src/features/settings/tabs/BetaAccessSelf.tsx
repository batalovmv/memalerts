import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppSelector } from '@/store/hooks';
import { api } from '@/lib/api';

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
    <section className="surface p-6">
      <h2 className="text-2xl font-bold dark:text-white">{t('admin.betaAccess')}</h2>
      <p className="mt-2 text-gray-700 dark:text-gray-200">
        {t('betaAccess.pageDescription', { defaultValue: 'Beta is for testing new features. You can request access below.' })}
      </p>

      {loading ? (
        <div className="mt-6 text-gray-600 dark:text-gray-300">{t('common.loading')}</div>
      ) : status?.hasAccess ? (
        <div className="mt-6 glass p-4 flex items-center gap-3 text-gray-900 dark:text-white">
          <div className="w-6 h-6 rounded-full bg-green-500 text-white flex items-center justify-center">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
            </svg>
          </div>
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
          <button
            type="button"
            onClick={request}
            disabled={requesting}
            className="glass-btn px-4 py-2 text-sm font-semibold text-gray-900 dark:text-white disabled:opacity-60"
          >
            {requesting ? t('common.loading') : t('betaAccess.requestButton')}
          </button>
        </div>
      )}
    </section>
  );
}


