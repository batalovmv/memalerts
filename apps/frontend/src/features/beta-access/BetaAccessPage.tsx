import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import Header from '@/components/Header';
import { api } from '@/lib/api';
import { useAppSelector } from '@/store/hooks';

type BetaAccessStatus = {
  hasAccess: boolean;
  request: {
    id: string;
    status: 'pending' | 'approved' | 'rejected' | 'revoked';
    requestedAt: string;
    approvedAt?: string;
  } | null;
};

export default function BetaAccess() {
  const { t } = useTranslation();
  const { user } = useAppSelector((s) => s.auth);
  const [status, setStatus] = useState<BetaAccessStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [requesting, setRequesting] = useState(false);

  const loadStatus = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const res = await api.get<BetaAccessStatus>('/beta/status', { timeout: 10000 });
      setStatus(res);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const handleRequest = async () => {
    setRequesting(true);
    try {
      await api.post('/beta/request');
      await loadStatus();
    } finally {
      setRequesting(false);
    }
  };

  const requestStatus = status?.request?.status;
  const hasAccess = !!status?.hasAccess;
  const canRequest =
    !!status &&
    !hasAccess &&
    (requestStatus === null || requestStatus === undefined || requestStatus === 'rejected');

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900">
      <Header />
      <main className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <section className="surface p-6">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            {t('betaAccess.pageTitle', { defaultValue: 'Beta access' })}
          </h1>
          <p className="mt-2 text-gray-700 dark:text-gray-200">
            {t('betaAccess.pageDescription', {
              defaultValue: 'Beta is for testing new features. You can request access below.',
            })}
          </p>

          {!user && (
            <div className="mt-6 glass p-4 text-gray-800 dark:text-gray-200">
              {t('betaAccess.loginRequired', { defaultValue: 'Please log in to request beta access.' })}
            </div>
          )}

          {user && (
            <div className="mt-6">
              {loading ? (
                <div className="text-gray-600 dark:text-gray-300">{t('common.loading')}</div>
              ) : (
                <div className="glass p-4">
                  <div className="text-sm text-gray-700 dark:text-gray-200">
                    {t('betaAccess.currentStatus', { defaultValue: 'Current status:' })}{' '}
                    <span className="font-semibold">
                      {hasAccess
                        ? t('betaAccess.statusApproved', { defaultValue: 'approved' })
                        : requestStatus === 'pending'
                          ? t('betaAccess.statusPending', { defaultValue: 'pending' })
                          : requestStatus === 'rejected'
                            ? t('betaAccess.statusRejected', { defaultValue: 'rejected' })
                            : requestStatus === 'revoked'
                              ? t('betaAccess.statusRevoked', { defaultValue: 'revoked' })
                              : t('betaAccess.statusNone', { defaultValue: 'not requested' })}
                    </span>
                  </div>

                  {hasAccess && (
                    <div className="mt-4 flex items-center gap-3 text-gray-900 dark:text-white">
                      <div className="w-6 h-6 rounded-full bg-green-500 text-white flex items-center justify-center">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                      </div>
                      <div className="font-semibold">{t('betaAccess.hasAccess', { defaultValue: 'You already have beta access.' })}</div>
                    </div>
                  )}

                  {canRequest && (
                    <button
                      type="button"
                      onClick={handleRequest}
                      disabled={requesting}
                      className="mt-4 glass-btn px-4 py-2 text-sm font-semibold text-gray-900 dark:text-white disabled:opacity-60"
                    >
                      {requesting ? t('common.loading') : t('betaAccess.requestButton', { defaultValue: 'Request beta access' })}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}



