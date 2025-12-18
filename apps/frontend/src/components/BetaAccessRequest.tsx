import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppSelector } from '../store/hooks';
import { api } from '../lib/api';
import toast from 'react-hot-toast';

interface BetaAccessStatus {
  hasAccess: boolean;
  request: {
    id: string;
    status: string;
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

  useEffect(() => {
    if (user) {
      loadStatus();
    }
  }, [user]);

  const loadStatus = async () => {
    try {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'BetaAccessRequest.tsx:30',message:'loadStatus started',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
      // #endregion
      setLoading(true);
      const startTime = Date.now();
      const response = await api.get<BetaAccessStatus>('/beta/status');
      const duration = Date.now() - startTime;
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'BetaAccessRequest.tsx:33',message:'loadStatus completed',data:{hasAccess:response?.hasAccess,duration},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
      // #endregion
      setStatus(response);
    } catch (error) {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'BetaAccessRequest.tsx:35',message:'loadStatus error',data:{error:error instanceof Error ? error.message : String(error)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
      // #endregion
      console.error('Error loading beta access status:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleRequest = async () => {
    try {
      setRequesting(true);
      await api.post('/beta/request');
      toast.success(t('toast.betaAccessRequested'));
      loadStatus();
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

  // Don't show loading state - just show nothing until status is loaded
  // This prevents the yellow loading block from appearing
  if (loading) {
    return null;
  }

  if (status?.hasAccess) {
    return null; // User has access, no need to show request form
  }

  const requestStatus = status?.request?.status;

  return (
    <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-6 mb-4">
      <div className="flex items-start gap-4">
        <div className="flex-shrink-0">
          <svg className="w-6 h-6 text-yellow-600 dark:text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <div className="flex-1">
          <h3 className="text-lg font-semibold text-yellow-800 dark:text-yellow-200 mb-2">
            Beta Access Required
          </h3>
          {requestStatus === 'pending' && (
            <div>
              <p className="text-yellow-700 dark:text-yellow-300 mb-2">
                Your beta access request is pending approval. Please wait for admin approval.
              </p>
              <p className="text-sm text-yellow-600 dark:text-yellow-400">
                Requested: {status?.request?.requestedAt ? new Date(status.request.requestedAt).toLocaleString() : 'N/A'}
              </p>
            </div>
          )}
          {requestStatus === 'rejected' && (
            <div>
              <p className="text-yellow-700 dark:text-yellow-300 mb-2">
                Your beta access request was rejected. Please contact an administrator.
              </p>
            </div>
          )}
          {!requestStatus && (
            <div>
              <p className="text-yellow-700 dark:text-yellow-300 mb-4">
                You do not have access to the beta version. Please request access to continue.
              </p>
              <button
                onClick={handleRequest}
                disabled={requesting}
                className="bg-yellow-600 hover:bg-yellow-700 text-white font-semibold py-2 px-4 rounded-lg transition-colors disabled:opacity-50"
              >
                {requesting ? t('common.loading') : 'Request Beta Access'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

