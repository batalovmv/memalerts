import { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

import { api } from '@/lib/api';
import { Button, Spinner } from '@/shared/ui';
import { useAppSelector } from '@/store/hooks';

interface BetaAccessStatus {
  hasAccess: boolean;
  request: {
    id: string;
    status: 'pending' | 'approved' | 'rejected' | 'revoked';
    requestedAt: string;
    approvedAt?: string;
  } | null;
}

export default function BetaAccessRequest() {
  const { t } = useTranslation();
  const { user } = useAppSelector((state) => state.auth);
  const [status, setStatus] = useState<BetaAccessStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [requesting, setRequesting] = useState(false);

  const loadStatus = useCallback(async () => {
    try {
      setLoading(true);
      const response = await api.get<BetaAccessStatus>('/beta/status', {
        timeout: 10000, // 10 seconds timeout
      });
      setStatus(response);
    } catch (error) {
      // Keep UI usable even if the status endpoint is temporarily unavailable.
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user) {
      loadStatus();
    }
  }, [user, loadStatus]);

  const handleRequest = async () => {
    try {
      setRequesting(true);
      await api.post('/beta/request');
      toast.success(t('toast.betaAccessRequested'));
      await loadStatus();
    } catch (error: unknown) {
      const apiError = error as { response?: { data?: { error?: string } } };
      toast.error(apiError.response?.data?.error || t('toast.failedToRequestBetaAccess'));
    } finally {
      setRequesting(false);
    }
  };

  if (!user) {
    return null;
  }

  // Full-page gate is rendered by App.tsx when user is on beta without access.
  // Here we still handle loading and rendering states.

  const requestStatus = status?.request?.status;

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100 dark:bg-gray-900 px-4">
        <div className="flex items-center gap-3 text-gray-700 dark:text-gray-200">
          <Spinner className="h-5 w-5" />
          <div className="text-base font-semibold">{t('common.loading')}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100 dark:bg-gray-900 px-4">
      <div className="max-w-lg w-full surface p-6">
        <div className="flex items-start gap-4">
          <div className="flex-shrink-0">
            <svg className="w-8 h-8 text-yellow-600 dark:text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <div className="flex-1">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
              {t('betaAccess.title', { defaultValue: 'Beta access required' })}
            </h1>
            <p className="text-gray-600 dark:text-gray-300 mb-4">
              {t('betaAccess.description', { defaultValue: 'You are logged in, but do not have access to the beta version.' })}
            </p>

            {requestStatus === 'revoked' && (
              <div className="mb-4">
                <p className="text-red-700 dark:text-red-300 font-medium">
                  {t('betaAccess.revoked', { defaultValue: 'Your beta access was revoked by an administrator.' })}
                </p>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                  {t('betaAccess.useProduction', { defaultValue: 'Please use the production site while you do not have beta access.' })}
                </p>
              </div>
            )}

            {requestStatus === 'pending' && (
              <div className="mb-4">
                <p className="text-yellow-700 dark:text-yellow-300 font-medium">
                  {t('betaAccess.pending', { defaultValue: 'Your request is pending approval.' })}
                </p>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                  {t('betaAccess.requestedAt', { defaultValue: 'Requested:' })}{' '}
                  {status?.request?.requestedAt ? new Date(status.request.requestedAt).toLocaleString() : 'N/A'}
                </p>
              </div>
            )}

            {requestStatus === 'rejected' && (
              <div className="mb-4">
                <p className="text-yellow-700 dark:text-yellow-300 font-medium">
                  {t('betaAccess.rejected', { defaultValue: 'Your request was rejected. You can submit a new request.' })}
                </p>
              </div>
            )}

            {(requestStatus === undefined || requestStatus === 'rejected') && (
              <div className="flex gap-3">
                <Button type="button" variant="primary" onClick={handleRequest} disabled={requesting}>
                  {requesting ? (
                    <span className="inline-flex items-center gap-2">
                      <Spinner className="h-4 w-4 border-white/40 border-t-white" />
                      {t('common.loading')}
                    </span>
                  ) : (
                    t('betaAccess.requestButton', { defaultValue: 'Request beta access' })
                  )}
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
