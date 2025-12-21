import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAppSelector, useAppDispatch } from '../store/hooks';
import { store } from '../store/index';
import { fetchSubmissions, approveSubmission, rejectSubmission } from '../store/slices/submissionsSlice';
import { fetchMemes } from '../store/slices/memesSlice';
import { useChannelColors } from '../contexts/ChannelColorsContext';
import Header from '../components/Header';
import VideoPreview from '../components/VideoPreview';
import { api } from '../lib/api';
import toast from 'react-hot-toast';
import { useAutoplayMemes } from '../hooks/useAutoplayMemes';
import SecretCopyField from '../components/SecretCopyField';

type TabType = 'submissions' | 'settings' | 'rewards' | 'obs' | 'wallets' | 'promotions' | 'statistics' | 'beta';

export default function Admin() {
  const { t } = useTranslation();
  const { user, loading: authLoading } = useAppSelector((state) => state.auth);
  const { submissions, loading: submissionsLoading, error: submissionsError } = useAppSelector((state) => state.submissions);
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<TabType>('settings');
  const [approveModal, setApproveModal] = useState<{ open: boolean; submissionId: string | null }>({
    open: false,
    submissionId: null,
  });
  const [rejectModal, setRejectModal] = useState<{ open: boolean; submissionId: string | null }>({
    open: false,
    submissionId: null,
  });
  const [approveForm, setApproveForm] = useState({
    priceCoins: '100',
    durationMs: '15000',
  });
  const [rejectReason, setRejectReason] = useState('');
  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false);
  const submissionsLoadedRef = useRef(false);
  const isBetaDomain = typeof window !== 'undefined' && window.location.hostname.includes('beta.');

  // Handle tab parameter from URL
  useEffect(() => {
    const tabParam = searchParams.get('tab');
    if (tabParam === 'submissions') {
      // Pending submissions live on the dashboard now.
      navigate('/dashboard?tab=submissions', { replace: true });
      return;
    }
    if (tabParam === 'memes') {
      // All memes now live on the dashboard for a more cohesive UX.
      navigate('/dashboard?panel=memes', { replace: true });
      return;
    }
    if (tabParam && ['settings', 'rewards', 'obs', 'wallets', 'promotions', 'statistics', 'beta'].includes(tabParam)) {
      setActiveTab(tabParam as TabType);
    }
  }, [searchParams, navigate]);

  useEffect(() => {
    if (!authLoading && (!user || (user.role !== 'streamer' && user.role !== 'admin'))) {
      navigate('/dashboard');
    }
  }, [user, authLoading, navigate]);

  useEffect(() => {
    if (user && (user.role === 'streamer' || user.role === 'admin')) {
      // Load submissions if not already loaded
      // Check Redux store with TTL to avoid duplicate requests on navigation
      const currentState = store.getState();
      const submissionsState = currentState.submissions;
      const SUBMISSIONS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
      
      // Check if we have fresh data based on timestamp
      const hasFreshData = submissionsState.submissions.length > 0 && 
        submissionsState.lastFetchedAt !== null &&
        (Date.now() - submissionsState.lastFetchedAt) < SUBMISSIONS_CACHE_TTL;
      
      const isSubmissionsLoading = submissionsState.loading;
      
      // Only fetch if no fresh data and not loading
      if (!hasFreshData && !isSubmissionsLoading && !submissionsLoadedRef.current) {
        submissionsLoadedRef.current = true;
        dispatch(fetchSubmissions({ status: 'pending' }));
      } else if (hasFreshData) {
        submissionsLoadedRef.current = true; // Mark as loaded even if we didn't fetch
      }
    }
    // Reset refs when user changes
    if (!user || !user.channelId) {
      submissionsLoadedRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, user?.role, user?.channelId, dispatch]);

  // Auto-detect video duration when approve modal opens
  useEffect(() => {
    if (approveModal.open && approveModal.submissionId) {
      const submission = submissions.find(s => s.id === approveModal.submissionId);
      if (submission?.fileUrlTemp && submission.type === 'video') {
        const video = document.createElement('video');
        video.preload = 'metadata';
        
        const handleLoadedMetadata = () => {
          if (video.duration && !isNaN(video.duration)) {
            const durationMs = Math.min(Math.ceil(video.duration * 1000), 15000);
            setApproveForm(prev => ({ ...prev, durationMs: String(durationMs) }));
          }
          window.URL.revokeObjectURL(video.src);
        };
        
        video.onloadedmetadata = handleLoadedMetadata;
        video.onerror = () => {
          window.URL.revokeObjectURL(video.src);
        };
        
        video.src = submission.fileUrlTemp;
      }
    }
  }, [approveModal.open, approveModal.submissionId, submissions]);

  const openApproveModal = (submissionId: string) => {
    setApproveModal({ open: true, submissionId });
    setApproveForm({ priceCoins: '100', durationMs: '15000' });
  };

  const closeApproveModal = () => {
    setApproveModal({ open: false, submissionId: null });
    setApproveForm({ priceCoins: '100', durationMs: '15000' });
  };

  const handleApprove = async (): Promise<void> => {
    if (!approveModal.submissionId) return;

    const priceCoins = parseInt(approveForm.priceCoins, 10);
    const durationMs = parseInt(approveForm.durationMs, 10);

    if (isNaN(priceCoins) || priceCoins < 1) {
      toast.error(t('admin.invalidPrice') || 'Price must be at least 1 coin');
      return;
    }

    // Duration is auto-detected; enforce 1s..15s.
    // We still send it so backend can persist correct duration when available.
    if (isNaN(durationMs) || durationMs < 1000 || durationMs > 15000) {
      toast.error(t('admin.invalidDuration') || 'Video must be 1s..15s');
      return;
    }

    try {
      await dispatch(approveSubmission({ 
        submissionId: approveModal.submissionId, 
        priceCoins,
        durationMs,
      })).unwrap();
      toast.success(t('admin.approve') + '!');
      closeApproveModal();
      dispatch(fetchSubmissions({ status: 'pending' }));
      if (user) {
        dispatch(fetchMemes({ channelId: user.channelId }));
      }
    } catch (error) {
      toast.error(t('admin.failedToApprove') || 'Failed to approve submission');
    }
  };

  const openRejectModal = (submissionId: string) => {
    setRejectModal({ open: true, submissionId });
    setRejectReason('');
  };

  const closeRejectModal = () => {
    setRejectModal({ open: false, submissionId: null });
    setRejectReason('');
  };

  const handleReject = async (): Promise<void> => {
    if (!rejectModal.submissionId) return;

    if (!rejectReason.trim()) {
      toast.error(t('admin.reasonRequired') || 'Please provide a reason for rejection');
      return;
    }

    try {
      await dispatch(rejectSubmission({ 
        submissionId: rejectModal.submissionId, 
        moderatorNotes: rejectReason.trim() 
      })).unwrap();
      toast.success(t('admin.reject') + '!');
      closeRejectModal();
      dispatch(fetchSubmissions({ status: 'pending' }));
    } catch (error) {
      toast.error(t('admin.failedToReject') || 'Failed to reject submission');
    }
  };

  if (authLoading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-xl">{t('common.loading')}</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900">
      <Header />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-6">
          <div className="flex gap-4 items-center border-b border-secondary/30">
            {/* Основные вкладки */}
            <button
              onClick={() => setActiveTab('settings')}
              className={`pb-2 px-4 transition-colors ${
                activeTab === 'settings'
                  ? 'border-b-2 border-primary text-primary'
                  : 'text-gray-600 dark:text-gray-400 hover:text-primary dark:hover:text-primary'
              }`}
            >
              {t('admin.channelDesign', 'Оформление')}
            </button>
            <button
              onClick={() => setActiveTab('rewards')}
              className={`pb-2 px-4 transition-colors ${
                activeTab === 'rewards'
                  ? 'border-b-2 border-primary text-primary'
                  : 'text-gray-600 dark:text-gray-400 hover:text-primary dark:hover:text-primary'
              }`}
            >
              {t('admin.rewards', 'Награды')}
            </button>
            <button
              onClick={() => setActiveTab('obs')}
              className={`pb-2 px-4 transition-colors ${
                activeTab === 'obs'
                  ? 'border-b-2 border-primary text-primary'
                  : 'text-gray-600 dark:text-gray-400 hover:text-primary dark:hover:text-primary'
              }`}
            >
              {t('admin.obsLinks', { defaultValue: 'OBS' })}
            </button>

            {/* Dropdown для дополнительных вкладок */}
            <div className="ml-auto relative">
              <button
                onClick={() => setIsMoreMenuOpen(!isMoreMenuOpen)}
                className={`pb-2 px-4 transition-colors flex items-center gap-1 ${
                  ['wallets', 'promotions', 'statistics', 'beta'].includes(activeTab)
                    ? 'border-b-2 border-primary text-primary'
                    : 'text-gray-600 dark:text-gray-400 hover:text-primary dark:hover:text-primary'
                }`}
              >
                {t('admin.more', 'More')}
                <svg 
                  className={`w-4 h-4 transition-transform ${isMoreMenuOpen ? 'rotate-180' : ''}`}
                  fill="none" 
                  stroke="currentColor" 
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {/* Dropdown меню */}
              {isMoreMenuOpen && (
                <>
                  <div 
                    className="fixed inset-0 z-10" 
                    onClick={() => setIsMoreMenuOpen(false)}
                  />
                  <div className="absolute right-0 mt-2 w-56 bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 z-20 py-1">
                    <button
                      onClick={() => {
                        setActiveTab('statistics');
                        setIsMoreMenuOpen(false);
                      }}
                      className={`w-full text-left px-4 py-2 text-sm transition-colors ${
                        activeTab === 'statistics'
                          ? 'bg-primary/10 text-primary'
                          : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                      }`}
                    >
                      {t('admin.statistics')}
                    </button>
                    <button
                      onClick={() => {
                        setActiveTab('promotions');
                        setIsMoreMenuOpen(false);
                      }}
                      className={`w-full text-left px-4 py-2 text-sm transition-colors ${
                        activeTab === 'promotions'
                          ? 'bg-primary/10 text-primary'
                          : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                      }`}
                    >
                      {t('admin.promotions')}
                    </button>
                    <div className="border-t border-gray-200 dark:border-gray-700 my-1" />

                    {user?.role === 'admin' && (
                      <button
                        onClick={() => {
                          setActiveTab('wallets');
                          setIsMoreMenuOpen(false);
                        }}
                        className={`w-full text-left px-4 py-2 text-sm transition-colors ${
                          activeTab === 'wallets'
                            ? 'bg-primary/10 text-primary'
                            : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                        }`}
                      >
                        {t('admin.walletManagement')}
                      </button>
                    )}

                    {isBetaDomain && (
                      <button
                        onClick={() => {
                          setActiveTab('beta');
                          setIsMoreMenuOpen(false);
                        }}
                        className={`w-full text-left px-4 py-2 text-sm transition-colors ${
                          activeTab === 'beta'
                            ? 'bg-primary/10 text-primary'
                            : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                        }`}
                      >
                        {t('admin.betaAccess')}
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {activeTab === 'submissions' && (
          <div className="space-y-4">
            {submissionsLoading ? (
              <div className="text-center py-8">{t('admin.loadingSubmissions')}</div>
            ) : submissionsError ? (
              <div className="text-center py-8">
                <p className="text-red-600 dark:text-red-400 mb-4">{submissionsError}</p>
                <button
                  onClick={() => dispatch(fetchSubmissions({ status: 'pending' }))}
                  className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded"
                >
                  {t('common.retry') || 'Retry'}
                </button>
              </div>
            ) : submissions.length === 0 ? (
              <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                <p>{t('admin.noSubmissions')}</p>
                <p className="text-sm mt-2">{t('admin.allSubmissionsReviewed')}</p>
              </div>
            ) : (
                     submissions.map((submission) => (
                       <div key={submission.id} className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
                         <div className="flex justify-between items-start mb-4">
                           <div className="flex-1">
                             <h3 className="font-semibold text-lg dark:text-white">{submission.title}</h3>
                             <p className="text-sm text-gray-600 dark:text-gray-400">
                               By {submission.submitter.displayName} • {submission.type}
                             </p>
                             {submission.notes && (
                               <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">{submission.notes}</p>
                             )}
                             {submission.tags && submission.tags.length > 0 && (
                               <div className="flex flex-wrap gap-1 mt-2">
                                 {submission.tags.map((tagItem, idx) => (
                                   <span
                                     key={idx}
                                     className="px-2 py-1 bg-accent/20 text-accent rounded text-xs"
                                   >
                                     {tagItem.tag.name}
                                   </span>
                                 ))}
                               </div>
                             )}
                    </div>
                  </div>
                  
                  {/* Video Preview */}
                  <div className="mb-4">
                    <VideoPreview 
                      src={submission.fileUrlTemp} 
                      title={submission.title}
                      className="w-full"
                    />
                  </div>
                  
                  <div className="flex gap-2">
                  <button
                    onClick={() => openApproveModal(submission.id)}
                    className="bg-green-600 hover:bg-green-700 text-white px-6 py-2 rounded transition-colors font-semibold"
                  >
                    {t('admin.approve')}
                  </button>
                  <button
                    onClick={() => openRejectModal(submission.id)}
                    className="bg-red-600 hover:bg-red-700 text-white px-6 py-2 rounded transition-colors font-semibold"
                  >
                    {t('admin.reject')}
                  </button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* Approve Modal */}
        {approveModal.open && (
          <div className="fixed inset-0 z-50 overflow-y-auto">
            <div 
              className="fixed inset-0 bg-black/50 transition-opacity"
              onClick={closeApproveModal}
              aria-hidden="true"
            />
            <div className="flex min-h-full items-center justify-center p-4">
              <div className="relative bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full">
                <div className="sticky top-0 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-4 flex justify-between items-center">
                  <h2 className="text-2xl font-bold dark:text-white">
                    {t('admin.approveSubmission', { defaultValue: 'Approve submission' })}
                  </h2>
                  <button
                    onClick={closeApproveModal}
                    className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                    aria-label={t('common.close') || 'Close'}
                  >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                <div className="p-6 space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      {t('admin.priceCoins', { defaultValue: 'Price (coins)' })}
                    </label>
                    <input
                      type="number"
                      min="1"
                      value={approveForm.priceCoins}
                      onChange={(e) => setApproveForm({ ...approveForm, priceCoins: e.target.value })}
                      className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-2 focus:ring-2 focus:ring-primary focus:border-primary"
                      required
                    />
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      {t('admin.priceCoinsDescription', { defaultValue: 'Minimum 1 coin' })}
                    </p>
                  </div>
                  <div className="flex gap-3 pt-4">
                    <button
                      type="button"
                      onClick={closeApproveModal}
                      className="flex-1 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200 font-semibold py-2 px-4 rounded-lg transition-colors"
                    >
                      {t('common.cancel')}
                    </button>
                    <button
                      type="button"
                      onClick={handleApprove}
                      className="flex-1 bg-green-600 hover:bg-green-700 text-white font-semibold py-2 px-4 rounded-lg transition-colors"
                    >
                      {t('admin.approve')}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Reject Modal */}
        {rejectModal.open && (
          <div className="fixed inset-0 z-50 overflow-y-auto">
            <div 
              className="fixed inset-0 bg-black/50 transition-opacity"
              onClick={closeRejectModal}
              aria-hidden="true"
            />
            <div className="flex min-h-full items-center justify-center p-4">
              <div className="relative bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full">
                <div className="sticky top-0 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-4 flex justify-between items-center">
                  <h2 className="text-2xl font-bold dark:text-white">{t('admin.rejectSubmission') || 'Reject Submission'}</h2>
                  <button
                    onClick={closeRejectModal}
                    className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                    aria-label={t('common.close') || 'Close'}
                  >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                <div className="p-6 space-y-4">
                  <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
                    <p className="text-sm text-red-800 dark:text-red-200 font-medium">
                      {t('admin.rejectWarning', { defaultValue: 'This action cannot be undone. Please provide a reason for rejection.' })}
                    </p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      {t('admin.rejectionReason') || 'Reason for rejection'} <span className="text-red-500">*</span>
                    </label>
                    <textarea
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                      rows={4}
                      className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-2 focus:ring-2 focus:ring-red-500 focus:border-red-500"
                      placeholder={t('admin.rejectionReasonPlaceholder', { defaultValue: 'Enter reason for rejection...' })}
                      required
                    />
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      {t('admin.rejectionReasonDescription', { defaultValue: 'This reason will be visible to the submitter' })}
                    </p>
                  </div>
                  <div className="flex gap-3 pt-4">
                    <button
                      type="button"
                      onClick={closeRejectModal}
                      className="flex-1 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200 font-semibold py-2 px-4 rounded-lg transition-colors"
                    >
                      {t('common.cancel')}
                    </button>
                    <button
                      type="button"
                      onClick={handleReject}
                      disabled={!rejectReason.trim()}
                      className="flex-1 bg-red-600 hover:bg-red-700 disabled:bg-gray-300 disabled:cursor-not-allowed disabled:hover:bg-gray-300 text-white font-semibold py-2 px-4 rounded-lg transition-colors"
                    >
                      {t('admin.reject')}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'settings' && (
          <ChannelSettings />
        )}

        {activeTab === 'rewards' && (
          <RewardsSettings />
        )}

        {activeTab === 'obs' && (
          <ObsLinksSettings />
        )}

        {activeTab === 'wallets' && user?.role === 'admin' && (
          <WalletManagement />
        )}

        {activeTab === 'promotions' && (
          <PromotionManagement />
        )}

        {activeTab === 'statistics' && (
          <ChannelStatistics />
        )}

        {activeTab === 'beta' && isBetaDomain && (
          user?.role === 'admin' ? <BetaAccessManagement /> : <BetaAccessSelf />
        )}
      </main>
    </div>
  );
}

function BetaAccessSelf() {
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

function ObsLinksSettings() {
  const { t } = useTranslation();
  const { user } = useAppSelector((state) => state.auth);
  const { getChannelData, getCachedChannelData } = useChannelColors();

  const channelSlug = user?.channel?.slug || '';
  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  const [overlayToken, setOverlayToken] = useState<string>('');
  const [loadingToken, setLoadingToken] = useState(false);

  const [overlayMode, setOverlayMode] = useState<'queue' | 'simultaneous'>('queue');
  const [overlayShowSender, setOverlayShowSender] = useState(false);
  const [loadingOverlaySettings, setLoadingOverlaySettings] = useState(false);
  const [savingOverlaySettings, setSavingOverlaySettings] = useState(false);
  const [rotatingOverlayToken, setRotatingOverlayToken] = useState(false);
  const overlaySettingsLoadedRef = useRef<string | null>(null);
  const lastSavedOverlaySettingsRef = useRef<string | null>(null);
  const lastChangeRef = useRef<'mode' | 'sender' | null>(null);
  const saveOverlayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const RotateIcon = () => (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M4.5 12a7.5 7.5 0 0112.8-5.303M19.5 12a7.5 7.5 0 01-12.8 5.303M16 6.5h1.8a.7.7 0 01.7.7V9M8 17.5H6.2a.7.7 0 01-.7-.7V15"
      />
    </svg>
  );

  const loadOverlaySettings = useCallback(async () => {
    if (!channelSlug) return;
    if (overlaySettingsLoadedRef.current === channelSlug) return;

    try {
      setLoadingOverlaySettings(true);

      const cached = getCachedChannelData(channelSlug);
      if (cached) {
        const nextMode = cached.overlayMode === 'simultaneous' ? 'simultaneous' : 'queue';
        const nextShowSender = Boolean(cached.overlayShowSender);
        setOverlayMode(nextMode);
        setOverlayShowSender(nextShowSender);
        // Mark current server state as "already saved" to prevent auto-save on first load.
        lastSavedOverlaySettingsRef.current = JSON.stringify({ overlayMode: nextMode, overlayShowSender: nextShowSender });
        lastChangeRef.current = null;
        overlaySettingsLoadedRef.current = channelSlug;
        return;
      }

      const data = await getChannelData(channelSlug, false);
      if (data) {
        const nextMode = data.overlayMode === 'simultaneous' ? 'simultaneous' : 'queue';
        const nextShowSender = Boolean(data.overlayShowSender);
        setOverlayMode(nextMode);
        setOverlayShowSender(nextShowSender);
        lastSavedOverlaySettingsRef.current = JSON.stringify({ overlayMode: nextMode, overlayShowSender: nextShowSender });
        lastChangeRef.current = null;
        overlaySettingsLoadedRef.current = channelSlug;
      } else {
        overlaySettingsLoadedRef.current = null;
      }
    } finally {
      setLoadingOverlaySettings(false);
    }
  }, [channelSlug, getCachedChannelData, getChannelData]);

  useEffect(() => {
    if (!channelSlug) return;
    let mounted = true;
    (async () => {
      try {
        setLoadingToken(true);
        const { api } = await import('../lib/api');
        const resp = await api.get<{ token: string }>('/admin/overlay/token');
        if (mounted) setOverlayToken(resp.token || '');
      } catch (e) {
        if (mounted) setOverlayToken('');
      } finally {
        if (mounted) setLoadingToken(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [channelSlug]);

  useEffect(() => {
    loadOverlaySettings();
  }, [loadOverlaySettings]);

  // Overlay is deployed under /overlay/ and expects /overlay/t/:token
  const overlayUrl = overlayToken ? `${origin}/overlay/t/${overlayToken}` : '';

  // Useful optional params for OBS:
  // - position: random|center|top|bottom|top-left|top-right|bottom-left|bottom-right
  // - scale: number
  // - volume: number (0..1)
  const overlayUrlWithDefaults = overlayUrl ? `${overlayUrl}?position=random&scale=1&volume=1` : '';

  // Auto-save overlay settings (no explicit Save button).
  useEffect(() => {
    if (!channelSlug) return;
    if (loadingOverlaySettings) return;
    if (!overlaySettingsLoadedRef.current) return;

    const payload = JSON.stringify({ overlayMode, overlayShowSender });
    // If we don't yet have a baseline, set it and do nothing (prevents save/toast on mount).
    if (lastSavedOverlaySettingsRef.current === null) {
      lastSavedOverlaySettingsRef.current = payload;
      lastChangeRef.current = null;
      return;
    }
    if (payload === lastSavedOverlaySettingsRef.current) return;

    if (saveOverlayTimerRef.current) clearTimeout(saveOverlayTimerRef.current);
    saveOverlayTimerRef.current = setTimeout(() => {
      void (async () => {
        try {
          setSavingOverlaySettings(true);
          const { api } = await import('../lib/api');
          await api.patch('/admin/channel/settings', {
            overlayMode,
            overlayShowSender,
          });
          lastSavedOverlaySettingsRef.current = payload;
          // Keep channel cache consistent (used by other panels).
          await getChannelData(channelSlug, false, true);

          // Explicit confirmation for the user.
          if (lastChangeRef.current === 'mode') {
            toast.success(
              overlayMode === 'queue'
                ? t('admin.obsOverlayModeSavedQueue', { defaultValue: 'Mode updated: Queue' })
                : t('admin.obsOverlayModeSavedUnlimited', { defaultValue: 'Mode updated: Unlimited' })
            );
          } else if (lastChangeRef.current === 'sender') {
            toast.success(
              overlayShowSender
                ? t('admin.obsOverlaySenderEnabled', { defaultValue: 'Sender name enabled' })
                : t('admin.obsOverlaySenderDisabled', { defaultValue: 'Sender name disabled' })
            );
          }
          lastChangeRef.current = null;
        } catch (error: unknown) {
          const apiError = error as { response?: { data?: { error?: string } } };
          toast.error(apiError.response?.data?.error || t('admin.failedToSave', { defaultValue: 'Failed to save' }));
        } finally {
          setSavingOverlaySettings(false);
        }
      })();
    }, 250);
  }, [channelSlug, getChannelData, loadingOverlaySettings, overlayMode, overlayShowSender, t]);

  useEffect(() => {
    return () => {
      if (saveOverlayTimerRef.current) clearTimeout(saveOverlayTimerRef.current);
    };
  }, []);

  const handleRotateOverlayToken = async (): Promise<void> => {
    if (!channelSlug) return;
    try {
      setRotatingOverlayToken(true);
      const { api } = await import('../lib/api');
      const resp = await api.post<{ token: string }>('/admin/overlay/token/rotate', {});
      setOverlayToken(resp?.token || '');
      toast.success(t('admin.obsOverlayTokenRotated', { defaultValue: 'Overlay link updated. Paste the new URL into OBS.' }));
    } catch (error: unknown) {
      const apiError = error as { response?: { data?: { error?: string } } };
      toast.error(apiError.response?.data?.error || t('admin.failedToSave', { defaultValue: 'Failed to save' }));
    } finally {
      setRotatingOverlayToken(false);
    }
  };

  return (
    <div className="surface p-6">
      <h2 className="text-2xl font-bold mb-4 dark:text-white">{t('admin.obsLinksTitle', { defaultValue: 'OBS links' })}</h2>
      <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
        {t('admin.obsLinksDescription', { defaultValue: 'Copy the overlay link and paste it into OBS as a Browser Source. The overlay will show activated memes in real time.' })}
      </p>

      <div className="space-y-6">
        <SecretCopyField
          label={t('admin.obsOverlayUrl', { defaultValue: 'Overlay URL (Browser Source)' })}
          value={overlayUrlWithDefaults}
          masked={true}
          emptyText={t('common.notAvailable', { defaultValue: 'Not available' })}
          description={loadingToken ? t('common.loading', { defaultValue: 'Loading...' }) : t('admin.obsOverlayUrlHint', { defaultValue: 'Click to copy. You can reveal the URL with the eye icon.' })}
          rightActions={
            <button
              type="button"
              className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors text-gray-700 dark:text-gray-200 disabled:opacity-60"
              onClick={(e) => {
                e.stopPropagation();
                void handleRotateOverlayToken();
              }}
              disabled={rotatingOverlayToken || loadingToken || !overlayToken}
              title={t('admin.obsOverlayRotateLinkHint', { defaultValue: 'Use this if your overlay URL was leaked. The old link will stop working.' })}
              aria-label={t('admin.obsOverlayRotateLink', { defaultValue: 'Update overlay link' })}
            >
              <RotateIcon />
            </button>
          }
        />

        <div className="glass p-4">
          <div className="font-semibold text-gray-900 dark:text-white mb-3">
            {t('admin.obsOverlaySettingsTitle', { defaultValue: 'Overlay settings' })}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                {t('admin.obsOverlayMode', { defaultValue: 'Mode' })}
              </label>
              <div className="inline-flex rounded-lg overflow-hidden glass-btn bg-white/40 dark:bg-white/5">
                <button
                  type="button"
                  onClick={() => {
                    lastChangeRef.current = 'mode';
                    setOverlayMode('queue');
                  }}
                  disabled={loadingOverlaySettings || savingOverlaySettings}
                  className={`px-3 py-2 text-sm font-medium ${
                    overlayMode === 'queue'
                      ? 'bg-primary text-white'
                      : 'bg-transparent text-gray-900 dark:text-white'
                  }`}
                >
                  {t('admin.obsOverlayModeQueueShort', { defaultValue: 'Queue' })}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    lastChangeRef.current = 'mode';
                    setOverlayMode('simultaneous');
                  }}
                  disabled={loadingOverlaySettings || savingOverlaySettings}
                  className={`px-3 py-2 text-sm font-medium border-l border-white/20 dark:border-white/10 ${
                    overlayMode === 'simultaneous'
                      ? 'bg-primary text-white'
                      : 'bg-transparent text-gray-900 dark:text-white'
                  }`}
                >
                  {t('admin.obsOverlayModeUnlimited', { defaultValue: 'Unlimited' })}
                </button>
              </div>
              <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                {overlayMode === 'queue'
                  ? t('admin.obsOverlayModeQueueHint', { defaultValue: 'Shows one meme at a time.' })
                  : t('admin.obsOverlayModeUnlimitedHint', { defaultValue: 'Shows all incoming memes at once (no limit).' })}
              </div>
            </div>

            <div className="flex items-start gap-3 pt-6">
              <input
                id="overlayShowSender"
                type="checkbox"
                checked={overlayShowSender}
                onChange={(e) => {
                  lastChangeRef.current = 'sender';
                  setOverlayShowSender(e.target.checked);
                }}
                className="mt-1 h-4 w-4 rounded border-white/20 dark:border-white/10 bg-white/60 dark:bg-white/10"
                disabled={loadingOverlaySettings || savingOverlaySettings}
              />
              <label htmlFor="overlayShowSender" className="text-sm text-gray-800 dark:text-gray-100">
                <div className="font-medium">{t('admin.obsOverlayShowSender', { defaultValue: 'Show sender name' })}</div>
                <div className="text-xs text-gray-600 dark:text-gray-300">
                  {t('admin.obsOverlayShowSenderHint', { defaultValue: 'Name is provided by the server (not the client).' })}
                </div>
              </label>
            </div>
          </div>
        </div>

        <div className="glass p-4">
          <div className="font-semibold text-gray-900 dark:text-white mb-2">
            {t('admin.obsHowToTitle', { defaultValue: 'How to add in OBS' })}
          </div>
          <ol className="list-decimal list-inside text-sm text-gray-700 dark:text-gray-200 space-y-1">
            <li>{t('admin.obsHowToStep1', { defaultValue: 'Add a new Browser Source.' })}</li>
            <li>{t('admin.obsHowToStep2', { defaultValue: 'Paste the Overlay URL.' })}</li>
            <li>{t('admin.obsHowToStep3', { defaultValue: 'Set Width/Height (e.g. 1920×1080) and enable “Shutdown source when not visible” if you want.' })}</li>
          </ol>
        </div>
      </div>
    </div>
  );
}

// Wallet Management Component (Admin only)
function WalletManagement() {
  const { t } = useTranslation();
  const [wallets, setWallets] = useState<Array<Record<string, unknown>>>([]);
  const [loading, setLoading] = useState(true);
  const [adjusting, setAdjusting] = useState<string | null>(null);
  const [adjustAmount, setAdjustAmount] = useState('');
  const walletsLoadedRef = useRef(false);

  const fetchWallets = useCallback(async () => {
    if (walletsLoadedRef.current) return; // Prevent duplicate requests
    
    try {
      setLoading(true);
      walletsLoadedRef.current = true;
      const { api } = await import('../lib/api');
      const wallets = await api.get<Array<Record<string, unknown>>>('/admin/wallets');
      setWallets(wallets);
    } catch (error: unknown) {
      const apiError = error as { response?: { data?: { error?: string } } };
      walletsLoadedRef.current = false; // Reset on error to allow retry
      toast.error(apiError.response?.data?.error || t('admin.failedToLoadWallets') || 'Failed to load wallets');
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    fetchWallets();
  }, [fetchWallets]);

  const handleAdjust = async (userId: string, channelId: string) => {
    const amount = parseInt(adjustAmount, 10);
    if (isNaN(amount) || amount === 0) {
      toast.error(t('admin.enterAmount'));
      return;
    }

    try {
      setAdjusting(`${userId}-${channelId}`);
      const { api } = await import('../lib/api');
      await api.post(`/admin/wallets/${userId}/${channelId}/adjust`, { amount });
      toast.success(amount > 0 ? t('admin.balanceIncreased', { amount: Math.abs(amount) }) : t('admin.balanceDecreased', { amount: Math.abs(amount) }));
      setAdjustAmount('');
      fetchWallets();
    } catch (error: unknown) {
      const apiError = error as { response?: { data?: { error?: string } } };
      toast.error(apiError.response?.data?.error || t('admin.failedToAdjustBalance') || 'Failed to adjust balance');
    } finally {
      setAdjusting(null);
    }
  };

  if (loading) {
    return <div className="text-center py-8">{t('admin.loadingWallets')}</div>;
  }

  return (
    <div className="space-y-4">
      <div className="surface p-6">
        <h2 className="text-2xl font-bold mb-4 dark:text-white">{t('admin.walletManagement')}</h2>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
                <th className="p-2">{t('admin.user')}</th>
                <th className="p-2">{t('admin.channel') || 'Channel'}</th>
                <th className="p-2">{t('admin.balance') || 'Balance'}</th>
                <th className="p-2">{t('common.actions') || 'Actions'}</th>
              </tr>
            </thead>
            <tbody>
              {wallets.map((wallet) => {
                const w = wallet as { id: string; userId: string; channelId: string; balance: number; user: { displayName: string }; channel: { name: string } };
                return (
                <tr key={w.id} className="border-t border-gray-200/70 dark:border-white/10">
                  <td className="p-2 dark:text-gray-100">{w.user.displayName}</td>
                  <td className="p-2 dark:text-gray-100">{w.channel.name}</td>
                  <td className="p-2 font-bold dark:text-white">{w.balance} coins</td>
                  <td className="p-2">
                    <div className="flex gap-2 items-center">
                      <input
                        type="number"
                        value={adjusting === `${w.userId}-${w.channelId}` ? adjustAmount : ''}
                        onChange={(e) => setAdjustAmount(e.target.value)}
                        placeholder={t('admin.amount')}
                        className="w-24 rounded px-2 py-1 text-sm bg-gray-50 dark:bg-gray-900/40 text-gray-900 dark:text-white shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                        disabled={adjusting !== null && adjusting !== `${w.userId}-${w.channelId}`}
                      />
                      <button
                        onClick={() => handleAdjust(w.userId, w.channelId)}
                        disabled={adjusting !== null}
                        className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white px-3 py-1 rounded text-sm"
                      >
                        {adjusting === `${w.userId}-${w.channelId}` ? t('admin.adjusting') : t('admin.adjust')}
                      </button>
                    </div>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {wallets.length === 0 && (
          <div className="text-center py-8 text-gray-500 dark:text-gray-400">{t('admin.noWallets')}</div>
        )}
      </div>
    </div>
  );
}

// Rewards Settings Component
function RewardsSettings() {
  const { t } = useTranslation();
  const { user } = useAppSelector((state) => state.auth);
  const { getChannelData, getCachedChannelData } = useChannelColors();
  const [rewardSettings, setRewardSettings] = useState({
    rewardIdForCoins: '',
    rewardEnabled: false,
    rewardTitle: '',
    rewardCost: '',
    rewardCoins: '',
    submissionRewardCoins: '0',
  });
  const [savingTwitchReward, setSavingTwitchReward] = useState(false);
  const [savingApprovedMemeReward, setSavingApprovedMemeReward] = useState(false);
  const saveTwitchTimerRef = useRef<number | null>(null);
  const saveApprovedTimerRef = useRef<number | null>(null);
  const lastSavedTwitchRef = useRef<string | null>(null);
  const lastSavedApprovedRef = useRef<string | null>(null);
  const settingsLoadedRef = useRef<string | null>(null);

  const loadRewardSettings = useCallback(async () => {
    if (!user?.channel?.slug) return;
    
    if (settingsLoadedRef.current === user.channel.slug) {
      return;
    }
    
    try {
      const cached = getCachedChannelData(user.channel.slug);
      if (cached) {
        setRewardSettings({
          rewardIdForCoins: cached.rewardIdForCoins || '',
          rewardEnabled: cached.rewardEnabled || false,
          rewardTitle: cached.rewardTitle || '',
          rewardCost: cached.rewardCost ? String(cached.rewardCost) : '',
          rewardCoins: cached.rewardCoins ? String(cached.rewardCoins) : '',
          submissionRewardCoins: cached.submissionRewardCoins !== undefined ? String(cached.submissionRewardCoins) : '0',
        });
        settingsLoadedRef.current = user.channel.slug;
        lastSavedTwitchRef.current = JSON.stringify({
          rewardIdForCoins: cached.rewardIdForCoins || null,
          rewardEnabled: cached.rewardEnabled || false,
          rewardTitle: cached.rewardTitle || null,
          rewardCost: cached.rewardCost ?? null,
          rewardCoins: cached.rewardCoins ?? null,
        });
        lastSavedApprovedRef.current = JSON.stringify({
          submissionRewardCoins: cached.submissionRewardCoins !== undefined ? cached.submissionRewardCoins : 0,
        });
        return;
      }

      const channelData = await getChannelData(user.channel.slug);
      if (channelData) {
        setRewardSettings({
          rewardIdForCoins: channelData.rewardIdForCoins || '',
          rewardEnabled: channelData.rewardEnabled || false,
          rewardTitle: channelData.rewardTitle || '',
          rewardCost: channelData.rewardCost ? String(channelData.rewardCost) : '',
          rewardCoins: channelData.rewardCoins ? String(channelData.rewardCoins) : '',
          submissionRewardCoins: channelData.submissionRewardCoins !== undefined ? String(channelData.submissionRewardCoins) : '0',
        });
        settingsLoadedRef.current = user.channel.slug;
        lastSavedTwitchRef.current = JSON.stringify({
          rewardIdForCoins: channelData.rewardIdForCoins || null,
          rewardEnabled: channelData.rewardEnabled || false,
          rewardTitle: channelData.rewardTitle || null,
          rewardCost: channelData.rewardCost ?? null,
          rewardCoins: channelData.rewardCoins ?? null,
        });
        lastSavedApprovedRef.current = JSON.stringify({
          submissionRewardCoins: channelData.submissionRewardCoins !== undefined ? channelData.submissionRewardCoins : 0,
        });
      }
    } catch (error) {
      settingsLoadedRef.current = null;
    }
  }, [user?.channel?.slug, getChannelData, getCachedChannelData]);

  useEffect(() => {
    if (user?.channelId && user?.channel?.slug) {
      loadRewardSettings();
    } else {
      settingsLoadedRef.current = null;
    }
  }, [loadRewardSettings, user?.channelId, user?.channel?.slug]);

  const handleSaveTwitchReward = async () => {
    setSavingTwitchReward(true);
    try {
      const { api } = await import('../lib/api');
      await api.patch('/admin/channel/settings', {
        // Twitch reward only (do NOT include submissionRewardCoins here)
        rewardIdForCoins: rewardSettings.rewardIdForCoins || null,
        rewardEnabled: rewardSettings.rewardEnabled,
        rewardTitle: rewardSettings.rewardTitle || null,
        rewardCost: rewardSettings.rewardCost ? parseInt(rewardSettings.rewardCost, 10) : null,
        rewardCoins: rewardSettings.rewardCoins ? parseInt(rewardSettings.rewardCoins, 10) : null,
      });
      lastSavedTwitchRef.current = JSON.stringify({
        rewardIdForCoins: rewardSettings.rewardIdForCoins || null,
        rewardEnabled: rewardSettings.rewardEnabled,
        rewardTitle: rewardSettings.rewardTitle || null,
        rewardCost: rewardSettings.rewardCost ? parseInt(rewardSettings.rewardCost, 10) : null,
        rewardCoins: rewardSettings.rewardCoins ? parseInt(rewardSettings.rewardCoins, 10) : null,
      });
    } catch (error: unknown) {
      const apiError = error as { response?: { data?: { error?: string } } };
      const errorMessage = apiError.response?.data?.error || t('admin.failedToSaveSettings') || 'Failed to save settings';
      toast.error(errorMessage);

      if (apiError.response?.data && typeof apiError.response.data === 'object' && 'requiresReauth' in apiError.response.data) {
        setTimeout(() => {
          if (window.confirm(t('admin.requiresReauth') || 'You need to log out and log in again to enable Twitch rewards. Log out now?')) {
            window.location.href = '/';
          }
        }, 2000);
      }
    } finally {
      setSavingTwitchReward(false);
    }
  };

  const handleSaveApprovedMemeReward = async () => {
    setSavingApprovedMemeReward(true);
    try {
      const coins = rewardSettings.submissionRewardCoins ? parseInt(rewardSettings.submissionRewardCoins, 10) : 0;
      if (Number.isNaN(coins) || coins < 0) {
        toast.error(t('admin.invalidSubmissionRewardCoins', 'Введите корректное число (0 или больше)'));
        return;
      }
      const { api } = await import('../lib/api');
      await api.patch('/admin/channel/settings', {
        // Approved meme reward only (do NOT include Twitch reward fields here)
        submissionRewardCoins: coins,
      });
      lastSavedApprovedRef.current = JSON.stringify({ submissionRewardCoins: coins });
    } catch (error: unknown) {
      const apiError = error as { response?: { data?: { error?: string } } };
      const errorMessage = apiError.response?.data?.error || t('admin.failedToSaveSettings') || 'Failed to save settings';
      toast.error(errorMessage);
    } finally {
      setSavingApprovedMemeReward(false);
    }
  };

  // Autosave: Twitch reward fields (debounced)
  useEffect(() => {
    if (!user?.channel?.slug) return;
    if (!settingsLoadedRef.current) return;

    const payload = JSON.stringify({
      rewardIdForCoins: rewardSettings.rewardIdForCoins || null,
      rewardEnabled: rewardSettings.rewardEnabled,
      rewardTitle: rewardSettings.rewardTitle || null,
      rewardCost: rewardSettings.rewardCost ? parseInt(rewardSettings.rewardCost, 10) : null,
      rewardCoins: rewardSettings.rewardCoins ? parseInt(rewardSettings.rewardCoins, 10) : null,
    });

    if (payload === lastSavedTwitchRef.current) return;
    if (saveTwitchTimerRef.current) window.clearTimeout(saveTwitchTimerRef.current);
    saveTwitchTimerRef.current = window.setTimeout(() => {
      void handleSaveTwitchReward();
    }, 500);

    return () => {
      if (saveTwitchTimerRef.current) window.clearTimeout(saveTwitchTimerRef.current);
      saveTwitchTimerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    rewardSettings.rewardIdForCoins,
    rewardSettings.rewardEnabled,
    rewardSettings.rewardTitle,
    rewardSettings.rewardCost,
    rewardSettings.rewardCoins,
    user?.channel?.slug,
  ]);

  // Autosave: Approved meme reward coins (debounced)
  useEffect(() => {
    if (!user?.channel?.slug) return;
    if (!settingsLoadedRef.current) return;

    const coins = rewardSettings.submissionRewardCoins ? parseInt(rewardSettings.submissionRewardCoins, 10) : 0;
    const payload = JSON.stringify({ submissionRewardCoins: Number.isFinite(coins) ? coins : 0 });

    if (payload === lastSavedApprovedRef.current) return;
    if (saveApprovedTimerRef.current) window.clearTimeout(saveApprovedTimerRef.current);
    saveApprovedTimerRef.current = window.setTimeout(() => {
      void handleSaveApprovedMemeReward();
    }, 500);

    return () => {
      if (saveApprovedTimerRef.current) window.clearTimeout(saveApprovedTimerRef.current);
      saveApprovedTimerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rewardSettings.submissionRewardCoins, user?.channel?.slug]);

  return (
    <div className="surface p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold dark:text-white">{t('admin.rewards', 'Награды')}</h2>
        {/* Future: Add new reward button - пока скрыто, так как только одна награда */}
        {/* <button
          className="bg-primary hover:bg-secondary text-white font-semibold py-2 px-4 rounded-lg transition-colors"
          disabled
          title={t('admin.addRewardComingSoon', 'Скоро будет доступно')}
        >
          {t('admin.addReward', 'Добавить награду')}
        </button> */}
      </div>

      <div className="space-y-4">
        {/* Card A: Twitch reward (Channel Points -> coins) */}
        <div className="glass p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-lg font-semibold dark:text-white mb-1">
                {t('admin.twitchCoinsRewardTitle', 'Награда за монеты (Twitch)')}
              </h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {t('admin.twitchCoinsRewardDescription', 'Зритель тратит Channel Points на Twitch и получает монеты на сайте.')}
              </p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={rewardSettings.rewardEnabled}
                onChange={(e) => setRewardSettings({ ...rewardSettings, rewardEnabled: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/20 dark:peer-focus:ring-primary/30 rounded-full peer dark:bg-gray-600 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-primary"></div>
            </label>
          </div>

          {rewardSettings.rewardEnabled && (
            <div className="space-y-4 mt-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {t('admin.rewardTitle')}
                </label>
                <input
                  type="text"
                  value={rewardSettings.rewardTitle}
                  onChange={(e) => setRewardSettings({ ...rewardSettings, rewardTitle: e.target.value })}
                  className="w-full rounded-lg px-3 py-2 bg-white/60 dark:bg-white/10 text-gray-900 dark:text-white shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                  placeholder={t('admin.rewardTitlePlaceholder')}
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="flex flex-col">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    {t('admin.rewardCost')}
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={rewardSettings.rewardCost}
                    onChange={(e) => {
                      const next = e.target.value.replace(/[^\d]/g, '');
                      setRewardSettings({ ...rewardSettings, rewardCost: next });
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'e' || e.key === 'E' || e.key === '+' || e.key === '-' || e.key === '.') {
                        e.preventDefault();
                      }
                    }}
                    className="w-full rounded-lg px-3 py-2 bg-white/60 dark:bg-white/10 text-gray-900 dark:text-white shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                    placeholder="100"
                    required={rewardSettings.rewardEnabled}
                  />
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 min-h-[2.25rem]">
                    {t('admin.rewardCostDescription')}
                  </p>
                </div>
                <div className="flex flex-col">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    {t('admin.rewardCoins')}
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={rewardSettings.rewardCoins}
                    onChange={(e) => {
                      const next = e.target.value.replace(/[^\d]/g, '');
                      setRewardSettings({ ...rewardSettings, rewardCoins: next });
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'e' || e.key === 'E' || e.key === '+' || e.key === '-' || e.key === '.') {
                        e.preventDefault();
                      }
                    }}
                    className="w-full rounded-lg px-3 py-2 bg-white/60 dark:bg-white/10 text-gray-900 dark:text-white shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                    placeholder="100"
                    required={rewardSettings.rewardEnabled}
                  />
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 min-h-[2.25rem]">
                    {t('admin.rewardCoinsDescription')}
                  </p>
                </div>
              </div>
              <div>
                <SecretCopyField
                  label={`${t('admin.rewardIdForCoins', { defaultValue: 'Reward ID' })} (${t('admin.autoGenerated', { defaultValue: 'auto-generated' })})`}
                  value={rewardSettings.rewardIdForCoins}
                  masked={true}
                  description={t('admin.rewardIdDescription', { defaultValue: 'Click to copy. Use the eye icon to reveal.' })}
                  emptyText={t('common.notSet', { defaultValue: 'Not set' })}
                />
              </div>
            </div>
          )}

          <div className="mt-4 pt-4 text-xs text-gray-500 dark:text-gray-300">
            {savingTwitchReward ? t('admin.saving', { defaultValue: 'Saving…' }) : t('admin.saved', { defaultValue: 'Saved' })}
          </div>
        </div>

        {/* Card B: Approved meme reward (coins) */}
        <div className="glass p-6">
          <div className="mb-4">
            <h3 className="text-lg font-semibold dark:text-white mb-1">
              {t('admin.approvedMemeRewardTitle', 'Награда за одобренный мем (монеты)')}
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {t('admin.approvedMemeRewardDescription', 'Начисляется автору заявки после одобрения. 0 — выключено.')}
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {t('admin.submissionRewardCoins', { defaultValue: 'Reward for approved submission (coins)' })}
            </label>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={rewardSettings.submissionRewardCoins}
              onChange={(e) => {
                const next = e.target.value.replace(/[^\d]/g, '');
                setRewardSettings({ ...rewardSettings, submissionRewardCoins: next });
              }}
              onKeyDown={(e) => {
                if (e.key === 'e' || e.key === 'E' || e.key === '+' || e.key === '-' || e.key === '.') {
                  e.preventDefault();
                }
              }}
              className="w-full rounded-lg px-3 py-2 bg-white/60 dark:bg-white/10 text-gray-900 dark:text-white shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              placeholder="0"
            />
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              {t('admin.submissionRewardCoinsDescription', { defaultValue: 'Coins granted to the viewer when you approve their submission. Set 0 to disable.' })}
            </p>
          </div>

          <div className="mt-4 pt-4 text-xs text-gray-500 dark:text-gray-300">
            {savingApprovedMemeReward ? t('admin.saving', { defaultValue: 'Saving…' }) : t('admin.saved', { defaultValue: 'Saved' })}
          </div>
        </div>
      </div>
    </div>
  );
}

// Channel Settings Component (Colors only)
function ChannelSettings() {
  const { t } = useTranslation();
  const { user } = useAppSelector((state) => state.auth);
  const { getChannelData, getCachedChannelData } = useChannelColors();
  const { autoplayMemesEnabled, setAutoplayMemesEnabled } = useAutoplayMemes();
  const [settings, setSettings] = useState({
    primaryColor: '',
    secondaryColor: '',
    accentColor: '',
  });
  const [loading, setLoading] = useState(false);
  const saveTimerRef = useRef<number | null>(null);
  const lastSavedRef = useRef<string | null>(null);
  const settingsLoadedRef = useRef<string | null>(null); // Track which channel's settings were loaded

  const loadSettings = useCallback(async () => {
    if (!user?.channel?.slug) return;
    
    // Skip if already loaded for this channel
    if (settingsLoadedRef.current === user.channel.slug) {
      return;
    }
    
    try {
      // Check cache first
      const cached = getCachedChannelData(user.channel.slug);
      if (cached) {
        const nextSettings = {
          primaryColor: cached.primaryColor || '',
          secondaryColor: cached.secondaryColor || '',
          accentColor: cached.accentColor || '',
        };
        setSettings({
          primaryColor: nextSettings.primaryColor,
          secondaryColor: nextSettings.secondaryColor,
          accentColor: nextSettings.accentColor,
        });
        settingsLoadedRef.current = user.channel.slug;
        // Seed lastSaved to prevent immediate auto-save right after initial load.
        lastSavedRef.current = JSON.stringify({
          primaryColor: nextSettings.primaryColor || null,
          secondaryColor: nextSettings.secondaryColor || null,
          accentColor: nextSettings.accentColor || null,
          autoplayMemesEnabled,
        });
        return;
      }

      // If not in cache, fetch it
      const channelData = await getChannelData(user.channel.slug);
      if (channelData) {
        const nextSettings = {
          primaryColor: channelData.primaryColor || '',
          secondaryColor: channelData.secondaryColor || '',
          accentColor: channelData.accentColor || '',
        };
        setSettings({
          primaryColor: nextSettings.primaryColor,
          secondaryColor: nextSettings.secondaryColor,
          accentColor: nextSettings.accentColor,
        });
        settingsLoadedRef.current = user.channel.slug;
        // Seed lastSaved to prevent immediate auto-save right after initial load.
        lastSavedRef.current = JSON.stringify({
          primaryColor: nextSettings.primaryColor || null,
          secondaryColor: nextSettings.secondaryColor || null,
          accentColor: nextSettings.accentColor || null,
          autoplayMemesEnabled,
        });
      }
    } catch (error) {
      settingsLoadedRef.current = null; // Reset on error to allow retry
    }
  }, [user?.channel?.slug, getChannelData, getCachedChannelData]);

  useEffect(() => {
    // Load current settings
    if (user?.channelId && user?.channel?.slug) {
      loadSettings();
    } else {
      settingsLoadedRef.current = null; // Reset when user/channel changes
    }
  }, [loadSettings, user?.channelId, user?.channel?.slug]);

  // Auto-save channel design settings (no explicit Save button).
  useEffect(() => {
    if (!user?.channelId) return;
    if (!settingsLoadedRef.current) return; // don't save before initial load

    const payload = JSON.stringify({
      primaryColor: settings.primaryColor || null,
      secondaryColor: settings.secondaryColor || null,
      accentColor: settings.accentColor || null,
      autoplayMemesEnabled,
    });

    // Skip if nothing changed from last saved.
    if (payload === lastSavedRef.current) return;

    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      void (async () => {
        try {
          setLoading(true);
          const { api } = await import('../lib/api');
          await api.patch('/admin/channel/settings', {
            primaryColor: settings.primaryColor || null,
            secondaryColor: settings.secondaryColor || null,
            accentColor: settings.accentColor || null,
          });
          lastSavedRef.current = payload;
        } catch (error: unknown) {
          const apiError = error as { response?: { data?: { error?: string } } };
          toast.error(apiError.response?.data?.error || t('admin.failedToSaveSettings') || 'Failed to save settings');
        } finally {
          setLoading(false);
        }
      })();
    }, 350);

    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    };
  }, [
    settings.primaryColor,
    settings.secondaryColor,
    settings.accentColor,
    autoplayMemesEnabled,
    user?.channelId,
    t,
  ]);

  // Note: lastSavedRef is seeded during initial loadSettings to avoid immediate autosave.

  const profileUrl = user?.channel?.slug ? `https://twitchmemes.ru/channel/${user.channel.slug}` : '';

  return (
    <div className="surface p-6">
      <h2 className="text-2xl font-bold mb-4 dark:text-white">{t('admin.channelDesign', 'Оформление')}</h2>

      {/* Preferences */}
      <div className="mb-6 pb-6">
        <h3 className="text-lg font-semibold mb-3 dark:text-white">
          {t('admin.preferences', 'Предпочтения')}
        </h3>
        <div className="flex items-start justify-between gap-4 glass p-4">
          <div className="min-w-0">
            <div className="font-semibold text-gray-900 dark:text-white">
              {t('admin.autoplayMemesTitle', { defaultValue: 'Autoplay memes' })}
            </div>
            <div className="text-sm text-gray-600 dark:text-gray-300 mt-1">
              {t('admin.autoplayMemesDescription', { defaultValue: 'When enabled, meme previews autoplay (muted) on pages with many memes.' })}
            </div>
          </div>
          <label className="relative inline-flex items-center cursor-pointer shrink-0">
            <input
              type="checkbox"
              checked={autoplayMemesEnabled}
              onChange={(e) => setAutoplayMemesEnabled(e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/20 dark:peer-focus:ring-primary/30 rounded-full peer dark:bg-gray-600 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-primary"></div>
          </label>
        </div>
      </div>
      
      {/* Profile Link Section */}
      {profileUrl && (
        <div className="mb-6 pb-6">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            {t('admin.profileLink')}
          </label>
          <div className="flex items-center gap-2">
            <input
              type="text"
              readOnly
              value={profileUrl}
              className="flex-1 rounded-lg px-3 py-2 bg-white/60 dark:bg-white/10 text-gray-900 dark:text-white shadow-sm text-sm"
            />
            <button
              type="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(profileUrl);
                  toast.success(t('toast.linkCopied'));
                } catch (error) {
                  toast.error(t('toast.failedToCopyLink'));
                }
              }}
              className="p-2 rounded-lg hover:bg-white/70 dark:hover:bg-white/10 transition-colors glass-btn bg-white/40 dark:bg-white/5"
              title={t('dashboard.copyLink')}
            >
              <svg className="w-5 h-5 text-gray-600 dark:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </button>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            {t('dashboard.shareLinkDescription')}
          </p>
        </div>
      )}

      <div className="space-y-4">
        <div>
          <h3 className="text-lg font-semibold mb-4 dark:text-white">{t('admin.colorCustomization')}</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t('admin.primaryColor')}
              </label>
              <div className="flex gap-2">
                <input
                  type="color"
                  value={settings.primaryColor || '#9333ea'}
                  onChange={(e) => setSettings({ ...settings, primaryColor: e.target.value })}
                  className="w-16 h-10 rounded glass-btn bg-white/40 dark:bg-white/5"
                />
                <input
                  type="text"
                  value={settings.primaryColor}
                  onChange={(e) => setSettings({ ...settings, primaryColor: e.target.value })}
                  placeholder="#9333ea"
                  pattern="^#[0-9A-Fa-f]{6}$"
                  className="flex-1 rounded-lg px-3 py-2 bg-white/60 dark:bg-white/10 text-gray-900 dark:text-white shadow-sm"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t('admin.secondaryColor')}
              </label>
              <div className="flex gap-2">
                <input
                  type="color"
                  value={settings.secondaryColor || '#4f46e5'}
                  onChange={(e) => setSettings({ ...settings, secondaryColor: e.target.value })}
                  className="w-16 h-10 rounded glass-btn bg-white/40 dark:bg-white/5"
                />
                <input
                  type="text"
                  value={settings.secondaryColor}
                  onChange={(e) => setSettings({ ...settings, secondaryColor: e.target.value })}
                  placeholder="#4f46e5"
                  pattern="^#[0-9A-Fa-f]{6}$"
                  className="flex-1 rounded-lg px-3 py-2 bg-white/60 dark:bg-white/10 text-gray-900 dark:text-white shadow-sm"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t('admin.accentColor')}
              </label>
              <div className="flex gap-2">
                <input
                  type="color"
                  value={settings.accentColor || '#ec4899'}
                  onChange={(e) => setSettings({ ...settings, accentColor: e.target.value })}
                  className="w-16 h-10 rounded glass-btn bg-white/40 dark:bg-white/5"
                />
                <input
                  type="text"
                  value={settings.accentColor}
                  onChange={(e) => setSettings({ ...settings, accentColor: e.target.value })}
                  placeholder="#ec4899"
                  pattern="^#[0-9A-Fa-f]{6}$"
                  className="flex-1 rounded-lg px-3 py-2 bg-white/60 dark:bg-white/10 text-gray-900 dark:text-white shadow-sm"
                />
              </div>
            </div>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
            {t('admin.colorsVisibleToVisitors')}
          </p>
        </div>

        <div className="text-xs text-gray-500 dark:text-gray-400">
          {loading ? t('admin.saving', { defaultValue: 'Saving…' }) : t('admin.saved', { defaultValue: 'Saved' })}
        </div>
      </div>
    </div>
  );
}

// Channel Statistics Component
function ChannelStatistics() {
  const { t } = useTranslation();
  const [stats, setStats] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const statsLoadedRef = useRef(false);

  const fetchStats = useCallback(async () => {
    if (statsLoadedRef.current) return; // Prevent duplicate requests
    
    try {
      setLoading(true);
      statsLoadedRef.current = true;
      const { api } = await import('../lib/api');
      const stats = await api.get<Record<string, unknown>>('/admin/stats/channel');
      setStats(stats);
    } catch (error: unknown) {
      const apiError = error as { response?: { data?: { error?: string } } };
      statsLoadedRef.current = false; // Reset on error to allow retry
      toast.error(apiError.response?.data?.error || t('admin.failedToLoadStatistics') || 'Failed to load statistics');
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  if (loading) {
    return <div className="text-center py-8">{t('admin.loadingStatistics')}</div>;
  }

  if (!stats) {
    return <div className="text-center py-8 text-gray-500 dark:text-gray-400">{t('admin.noStatistics')}</div>;
  }

  const daily = (stats.daily as Array<{ day: string; activations: number; coins: number }> | undefined) || [];
  const maxDailyActivations = daily.reduce((m, d) => Math.max(m, d.activations || 0), 0) || 1;
  const maxDailyCoins = daily.reduce((m, d) => Math.max(m, d.coins || 0), 0) || 1;

  return (
    <div className="space-y-6">
      {/* Activity chart (last 14 days) */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 border border-secondary/20">
        <h2 className="text-2xl font-bold mb-4 dark:text-white">
          {t('admin.activityLast14Days', { defaultValue: 'Activity (last 14 days)' })}
        </h2>
        {daily.length === 0 ? (
          <div className="text-sm text-gray-600 dark:text-gray-400">
            {t('admin.noActivityYet', { defaultValue: 'No activity yet.' })}
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <div className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                {t('admin.dailyActivations', { defaultValue: 'Daily activations' })}
              </div>
              <div className="grid grid-cols-14 gap-1 items-end h-24">
                {daily.slice(-14).map((d) => {
                  const h = Math.round(((d.activations || 0) / maxDailyActivations) * 100);
                  const label = new Date(d.day).toLocaleDateString();
                  return (
                    <div key={`a-${d.day}`} className="h-full flex items-end">
                      <div
                        className="w-full rounded bg-primary/70"
                        style={{ height: `${Math.max(3, h)}%` }}
                        title={`${label}: ${d.activations || 0}`}
                      />
                    </div>
                  );
                })}
              </div>
            </div>

            <div>
              <div className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                {t('admin.dailyCoinsSpent', { defaultValue: 'Daily coins spent' })}
              </div>
              <div className="grid grid-cols-14 gap-1 items-end h-24">
                {daily.slice(-14).map((d) => {
                  const h = Math.round(((d.coins || 0) / maxDailyCoins) * 100);
                  const label = new Date(d.day).toLocaleDateString();
                  return (
                    <div key={`c-${d.day}`} className="h-full flex items-end">
                      <div
                        className="w-full rounded bg-accent/70"
                        style={{ height: `${Math.max(3, h)}%` }}
                        title={`${label}: ${d.coins || 0}`}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Overall Stats */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 border border-secondary/20">
        <h2 className="text-2xl font-bold mb-4 dark:text-white">{t('admin.overallStatistics') || 'Overall Statistics'}</h2>
        <div className="grid grid-cols-3 gap-4">
          <div className="text-center p-4 bg-primary/10 rounded-lg border border-secondary/20">
            <p className="text-3xl font-bold text-primary">{(stats.overall as { totalActivations: number })?.totalActivations || 0}</p>
            <p className="text-sm text-gray-600 dark:text-gray-400">{t('admin.totalActivations')}</p>
          </div>
          <div className="text-center p-4 bg-accent/10 rounded-lg border border-secondary/20">
            <p className="text-3xl font-bold text-accent">{(stats.overall as { totalCoinsSpent: number })?.totalCoinsSpent || 0}</p>
            <p className="text-sm text-gray-600 dark:text-gray-400">{t('admin.totalCoinsSpent')}</p>
          </div>
          <div className="text-center p-4 bg-secondary/10 rounded-lg border border-secondary/20">
            <p className="text-3xl font-bold text-secondary">{(stats.overall as { totalMemes: number })?.totalMemes || 0}</p>
            <p className="text-sm text-gray-600 dark:text-gray-400">{t('admin.totalMemes')}</p>
          </div>
        </div>
      </div>

      {/* Top Users */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 border border-secondary/20">
        <h2 className="text-2xl font-bold mb-4 dark:text-white">{t('admin.topUsersBySpending')}</h2>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700">
                <th className="text-left p-2 text-gray-700 dark:text-gray-300">{t('admin.user')}</th>
                <th className="text-left p-2 text-gray-700 dark:text-gray-300">{t('admin.activations')}</th>
                <th className="text-left p-2 text-gray-700 dark:text-gray-300">{t('admin.totalCoins')}</th>
              </tr>
            </thead>
            <tbody>
              {Array.isArray(stats.userSpending) && stats.userSpending.map((item: Record<string, unknown>) => {
                const i = item as { user: { id: string; displayName: string }; activationsCount: number; totalCoinsSpent: number };
                return (
                <tr key={i.user.id} className="border-b border-gray-200 dark:border-gray-700">
                  <td className="p-2 text-gray-900 dark:text-gray-100">{i.user.displayName}</td>
                  <td className="p-2 text-gray-900 dark:text-gray-100">{i.activationsCount}</td>
                  <td className="p-2 font-bold text-accent">{i.totalCoinsSpent}</td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Top Memes */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 border border-secondary/20">
        <h2 className="text-2xl font-bold mb-4 dark:text-white">{t('admin.mostPopularMemes')}</h2>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700">
                <th className="text-left p-2 text-gray-700 dark:text-gray-300">{t('admin.meme')}</th>
                <th className="text-left p-2 text-gray-700 dark:text-gray-300">{t('admin.activations')}</th>
                <th className="text-left p-2 text-gray-700 dark:text-gray-300">{t('admin.totalCoins')}</th>
              </tr>
            </thead>
            <tbody>
              {Array.isArray(stats.memePopularity) && stats.memePopularity.map((item: Record<string, unknown>, index: number) => {
                const i = item as { meme?: { id: string; title: string }; activationsCount: number; totalCoinsSpent: number };
                return (
                <tr key={i.meme?.id || index} className="border-b border-gray-200 dark:border-gray-700">
                  <td className="p-2 text-gray-900 dark:text-gray-100">{i.meme?.title || t('common.unknown') || 'Unknown'}</td>
                  <td className="p-2 text-gray-900 dark:text-gray-100">{i.activationsCount}</td>
                  <td className="p-2 font-bold text-accent">{i.totalCoinsSpent}</td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// Promotion Management Component
function PromotionManagement() {
  const { t } = useTranslation();
  const [promotions, setPromotions] = useState<Array<Record<string, unknown>>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const promotionsLoadedRef = useRef(false);
  const [formData, setFormData] = useState({
    name: '',
    discountPercent: '',
    startDate: '',
    endDate: '',
  });

  const fetchPromotions = useCallback(async () => {
    if (promotionsLoadedRef.current) return; // Prevent duplicate requests
    
    try {
      setLoading(true);
      setError(null);
      promotionsLoadedRef.current = true;
      const { api } = await import('../lib/api');
      const promotions = await api.get<Array<Record<string, unknown>>>('/admin/promotions');
      setPromotions(promotions);
    } catch (error: unknown) {
      const apiError = error as { response?: { data?: { error?: string } } };
      const errorMessage = apiError.response?.data?.error || 'Failed to load promotions';
      promotionsLoadedRef.current = false; // Reset on error to allow retry
      setError(errorMessage);
      toast.error(errorMessage);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPromotions();
  }, [fetchPromotions]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const { api } = await import('../lib/api');
      await api.post('/admin/promotions', {
        name: formData.name,
        discountPercent: parseFloat(formData.discountPercent),
        startDate: new Date(formData.startDate).toISOString(),
        endDate: new Date(formData.endDate).toISOString(),
      });
      toast.success(t('admin.promotionCreated'));
      setShowCreateForm(false);
      setFormData({ name: '', discountPercent: '', startDate: '', endDate: '' });
      promotionsLoadedRef.current = false; // Reset to allow reload
      fetchPromotions();
    } catch (error: unknown) {
      const apiError = error as { response?: { data?: { error?: string } } };
      toast.error(apiError.response?.data?.error || t('admin.failedToCreatePromotion') || 'Failed to create promotion');
    }
  };

  const handleToggleActive = async (id: string, currentActive: boolean) => {
    try {
      const { api } = await import('../lib/api');
      await api.patch(`/admin/promotions/${id}`, { isActive: !currentActive });
      toast.success(!currentActive ? t('admin.promotionActivated') : t('admin.promotionDeactivated'));
      promotionsLoadedRef.current = false; // Reset to allow reload
      fetchPromotions();
    } catch (error: unknown) {
      const apiError = error as { response?: { data?: { error?: string } } };
      toast.error(apiError.response?.data?.error || t('admin.failedToUpdatePromotion') || 'Failed to update promotion');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm(t('admin.deletePromotion'))) return;
    try {
      const { api } = await import('../lib/api');
      await api.delete(`/admin/promotions/${id}`);
      toast.success(t('admin.promotionDeleted'));
      promotionsLoadedRef.current = false; // Reset to allow reload
      fetchPromotions();
    } catch (error: unknown) {
      const apiError = error as { response?: { data?: { error?: string } } };
      toast.error(apiError.response?.data?.error || t('admin.failedToDeletePromotion') || 'Failed to delete promotion');
    }
  };

  if (loading) {
    return <div className="text-center py-8">{t('admin.loadingPromotions')}</div>;
  }

  if (error) {
    return (
      <div className="text-center py-8">
        <p className="text-red-600 dark:text-red-400 mb-4">{error}</p>
        <button
          onClick={() => {
            promotionsLoadedRef.current = false; // Reset to allow reload
            fetchPromotions();
          }}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded"
        >
          Retry
        </button>
      </div>
    );
  }

  const now = new Date();

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-2xl font-bold">{t('admin.promotions')}</h2>
          <button
            onClick={() => setShowCreateForm(!showCreateForm)}
            className="bg-primary hover:bg-secondary text-white px-4 py-2 rounded transition-colors"
          >
            {showCreateForm ? t('common.cancel') : t('admin.createPromotion')}
          </button>
        </div>

        {showCreateForm && (
          <form onSubmit={handleCreate} className="mb-6 p-4 bg-gray-50 rounded-lg space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('admin.name')}</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                required
                className="w-full border border-gray-300 rounded-lg px-3 py-2"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('admin.discountPercent')}
              </label>
              <input
                type="number"
                value={formData.discountPercent}
                onChange={(e) => setFormData({ ...formData, discountPercent: e.target.value })}
                required
                min="0"
                max="100"
                step="0.1"
                className="w-full border border-gray-300 rounded-lg px-3 py-2"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('admin.startDate')}</label>
                <input
                  type="datetime-local"
                  value={formData.startDate}
                  onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                  required
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('admin.endDate')}</label>
                <input
                  type="datetime-local"
                  value={formData.endDate}
                  onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
                  required
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                />
              </div>
            </div>
            <button
              type="submit"
              className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded"
            >
              {t('admin.create')}
            </button>
          </form>
        )}

        <div className="space-y-4">
          {promotions.length === 0 ? (
            <div className="text-center py-8 text-gray-500">{t('admin.noPromotions')}</div>
          ) : (
            promotions.map((promo) => {
              const p = promo as { id: string; name: string; discountPercent: number; startDate: string | number | Date; endDate: string | number | Date; isActive: boolean };
              const startDate = new Date(p.startDate);
              const endDate = new Date(p.endDate);
              const isCurrentlyActive = p.isActive && now >= startDate && now <= endDate;
              
              return (
                <div
                  key={p.id}
                  className={`p-4 border rounded-lg ${
                    isCurrentlyActive ? 'border-green-500 bg-green-50' : 'border-gray-300'
                  }`}
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <h3 className="font-semibold text-lg">{p.name}</h3>
                      <p className="text-accent font-bold">{p.discountPercent}% discount</p>
                      <p className="text-sm text-gray-600">
                        {startDate.toLocaleString()} - {endDate.toLocaleString()}
                      </p>
                      <div className="flex gap-2 mt-2">
                        <span
                        className={`px-2 py-1 rounded text-xs ${
                          p.isActive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                        }`}
                      >
                        {p.isActive ? t('admin.active') : t('admin.inactive')}
                      </span>
                      {isCurrentlyActive && (
                        <span className="px-2 py-1 rounded text-xs bg-green-200 text-green-900">
                          {t('admin.currentlyRunning')}
                        </span>
                      )}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleToggleActive(p.id, p.isActive)}
                        className={`px-3 py-1 rounded text-sm ${
                          p.isActive
                            ? 'bg-yellow-600 hover:bg-yellow-700'
                            : 'bg-green-600 hover:bg-green-700'
                        } text-white`}
                      >
                        {p.isActive ? t('admin.deactivate') : t('admin.activate')}
                      </button>
                      <button
                        onClick={() => handleDelete(p.id)}
                        className="bg-red-600 hover:bg-red-700 text-white px-3 py-1 rounded text-sm"
                      >
                        {t('common.delete')}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

// Beta Access Management Component (Admin only)
function BetaAccessManagement() {
  const { t } = useTranslation();
  const [requests, setRequests] = useState<Array<Record<string, unknown>>>([]);
  const [grantedUsers, setGrantedUsers] = useState<Array<Record<string, unknown>>>([]);
  const [revokedUsers, setRevokedUsers] = useState<Array<Record<string, unknown>>>([]);
  const [loading, setLoading] = useState(true);
  const [grantedLoading, setGrantedLoading] = useState(true);
  const [revokedLoading, setRevokedLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const requestsLoadedRef = useRef(false);
  const grantedLoadedRef = useRef(false);
  const revokedLoadedRef = useRef(false);

  const loadRequests = useCallback(async (opts?: { force?: boolean }) => {
    if (!opts?.force && requestsLoadedRef.current) return; // Prevent duplicate requests
    
    try {
      setLoading(true);
      requestsLoadedRef.current = true;
      const requests = await api.get<Array<Record<string, unknown>>>('/admin/beta/requests');
      setRequests(requests);
    } catch (error: unknown) {
      const apiError = error as { response?: { data?: { error?: string } } };
      requestsLoadedRef.current = false; // Reset on error to allow retry
      toast.error(apiError.response?.data?.error || t('toast.failedToLoad'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  const loadGrantedUsers = useCallback(async (opts?: { force?: boolean }) => {
    if (!opts?.force && grantedLoadedRef.current) return; // Prevent duplicate requests

    try {
      setGrantedLoading(true);
      grantedLoadedRef.current = true;
      const users = await api.get<Array<Record<string, unknown>>>('/admin/beta/users');
      setGrantedUsers(users);
    } catch (error: unknown) {
      const apiError = error as { response?: { data?: { error?: string } } };
      grantedLoadedRef.current = false; // Reset on error to allow retry
      toast.error(apiError.response?.data?.error || t('toast.failedToLoad'));
    } finally {
      setGrantedLoading(false);
    }
  }, [t]);

  const loadRevokedUsers = useCallback(async (opts?: { force?: boolean }) => {
    if (!opts?.force && revokedLoadedRef.current) return; // Prevent duplicate requests

    try {
      setRevokedLoading(true);
      revokedLoadedRef.current = true;
      const revoked = await api.get<Array<Record<string, unknown>>>('/admin/beta/users/revoked');
      setRevokedUsers(revoked);
    } catch (error: unknown) {
      const apiError = error as { response?: { data?: { error?: string } } };
      revokedLoadedRef.current = false; // Reset on error to allow retry
      toast.error(apiError.response?.data?.error || t('toast.failedToLoad'));
    } finally {
      setRevokedLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadRequests();
    loadGrantedUsers();
    loadRevokedUsers();
  }, [loadRequests, loadGrantedUsers, loadRevokedUsers]);

  const handleApprove = async (requestId: string) => {
    try {
      await api.post(`/admin/beta/requests/${requestId}/approve`);
      toast.success(t('toast.betaAccessApproved'));
      await Promise.all([
        loadRequests({ force: true }),
        loadGrantedUsers({ force: true }),
        loadRevokedUsers({ force: true }),
      ]);
    } catch (error: unknown) {
      const apiError = error as { response?: { data?: { error?: string } } };
      toast.error(apiError.response?.data?.error || t('toast.failedToApprove'));
    }
  };

  const handleReject = async (requestId: string) => {
    try {
      await api.post(`/admin/beta/requests/${requestId}/reject`);
      toast.success(t('toast.betaAccessRejected'));
      await Promise.all([
        loadRequests({ force: true }),
        loadGrantedUsers({ force: true }),
        loadRevokedUsers({ force: true }),
      ]);
    } catch (error: unknown) {
      const apiError = error as { response?: { data?: { error?: string } } };
      toast.error(apiError.response?.data?.error || t('toast.failedToReject'));
    }
  };

  const handleRevoke = async (targetUserId: string, displayName?: string) => {
    const label = displayName ? `@${displayName}` : targetUserId;
    const confirmed = window.confirm(t('admin.betaAccessRevokeConfirm', { user: label }));
    if (!confirmed) return;

    try {
      await api.post(`/admin/beta/users/${targetUserId}/revoke`);
      toast.success(t('toast.betaAccessRevoked'));
      await Promise.all([
        loadRequests({ force: true }),
        loadGrantedUsers({ force: true }),
        loadRevokedUsers({ force: true }),
      ]);
    } catch (error: unknown) {
      const apiError = error as { response?: { data?: { error?: string } } };
      toast.error(apiError.response?.data?.error || t('toast.failedToRevoke'));
    }
  };

  const handleRestore = async (targetUserId: string, displayName?: string) => {
    const label = displayName ? `@${displayName}` : targetUserId;
    const confirmed = window.confirm(t('admin.betaAccessRestoreConfirm', { user: label }));
    if (!confirmed) return;

    try {
      await api.post(`/admin/beta/users/${targetUserId}/restore`);
      toast.success(t('toast.betaAccessRestored'));
      await Promise.all([
        loadRequests({ force: true }),
        loadGrantedUsers({ force: true }),
        loadRevokedUsers({ force: true }),
      ]);
    } catch (error: unknown) {
      const apiError = error as { response?: { data?: { error?: string } } };
      toast.error(apiError.response?.data?.error || t('toast.failedToRestore'));
    }
  };

  const getStatusBadge = (status: string) => {
    const colors = {
      pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
      approved: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
      rejected: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
    };
    return (
      <span className={`px-2 py-1 rounded text-xs font-semibold ${colors[status as keyof typeof colors] || 'bg-gray-100 text-gray-800'}`}>
        {status}
      </span>
    );
  };

  if (loading) {
    return <div className="text-center py-8">{t('common.loading')}</div>;
  }

  const filteredGrantedUsers = grantedUsers.filter((u: Record<string, unknown>) => {
    const user = u as { displayName?: string; twitchUserId?: string };
    if (!searchQuery.trim()) return true;
    const q = searchQuery.trim().toLowerCase();
    return (
      (user.displayName || '').toLowerCase().includes(q) ||
      (user.twitchUserId || '').toLowerCase().includes(q)
    );
  });

  const filteredRevokedUsers = revokedUsers.filter((r: Record<string, unknown>) => {
    const row = r as { user?: { displayName?: string; twitchUserId?: string } };
    if (!searchQuery.trim()) return true;
    const q = searchQuery.trim().toLowerCase();
    return (
      (row.user?.displayName || '').toLowerCase().includes(q) ||
      (row.user?.twitchUserId || '').toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold dark:text-white">{t('admin.betaAccessRequests')}</h2>
      
      {requests.length === 0 ? (
        <div className="text-center py-8 text-gray-500 dark:text-gray-400">
          {t('admin.noBetaAccessRequests')}
        </div>
      ) : (
        <div className="space-y-4">
          {requests.map((request: Record<string, unknown>) => {
            const r = request as { id: string; status: string; requestedAt: string; approvedAt?: string; user?: { displayName: string; twitchUserId: string } };
            return (
            <div key={r.id} className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <div className="font-semibold text-gray-900 dark:text-white">
                    {r.user?.displayName || 'Unknown User'}
                  </div>
                  <div className="text-sm text-gray-500 dark:text-gray-400">
                    {r.user?.twitchUserId || 'N/A'}
                  </div>
                </div>
                {getStatusBadge(r.status)}
              </div>
              
              <div className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                <div>Requested: {new Date(r.requestedAt).toLocaleString()}</div>
                {r.approvedAt && (
                  <div>Processed: {new Date(r.approvedAt).toLocaleString()}</div>
                )}
              </div>

              {r.status === 'pending' && (
                <div className="flex gap-2">
                  <button
                    onClick={() => handleApprove(r.id)}
                    className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded transition-colors"
                  >
                    {t('admin.approve')}
                  </button>
                  <button
                    onClick={() => handleReject(r.id)}
                    className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded transition-colors"
                  >
                    {t('admin.reject')}
                  </button>
                </div>
              )}
            </div>
            );
          })}
        </div>
      )}

      <div className="pt-6 border-t border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between gap-4 mb-3">
          <h3 className="text-xl font-bold dark:text-white">{t('admin.betaAccessGranted')}</h3>
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('admin.searchUsers', 'Search users...')}
            className="w-full max-w-sm px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
          />
        </div>

        {grantedLoading ? (
          <div className="text-center py-6">{t('common.loading')}</div>
        ) : filteredGrantedUsers.length === 0 ? (
          <div className="text-center py-6 text-gray-500 dark:text-gray-400">
            {t('admin.noGrantedBetaUsers')}
          </div>
        ) : (
          <div className="space-y-3">
            {filteredGrantedUsers.map((u: Record<string, unknown>) => {
              const user = u as { id: string; displayName: string; twitchUserId?: string; role?: string; hasBetaAccess?: boolean };
              return (
                <div key={user.id} className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <div className="font-semibold text-gray-900 dark:text-white">{user.displayName || user.id}</div>
                      <div className="text-sm text-gray-500 dark:text-gray-400">
                        {user.twitchUserId || 'N/A'}{user.role ? ` • ${user.role}` : ''}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-1 rounded text-xs font-semibold bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                        {t('admin.betaAccessGrantedBadge', 'granted')}
                      </span>
                      <button
                        onClick={() => handleRevoke(user.id, user.displayName)}
                        className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded transition-colors"
                      >
                        {t('admin.revoke', 'Revoke')}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="pt-6 border-t border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between gap-4 mb-3">
          <h3 className="text-xl font-bold dark:text-white">{t('admin.betaAccessRevoked')}</h3>
        </div>

        {revokedLoading ? (
          <div className="text-center py-6">{t('common.loading')}</div>
        ) : filteredRevokedUsers.length === 0 ? (
          <div className="text-center py-6 text-gray-500 dark:text-gray-400">
            {t('admin.noRevokedBetaUsers')}
          </div>
        ) : (
          <div className="space-y-3">
            {filteredRevokedUsers.map((row: Record<string, unknown>) => {
              const r = row as {
                id: string;
                approvedAt?: string | null;
                user: { id: string; displayName: string; twitchUserId?: string; role?: string };
              };
              return (
                <div key={r.user.id} className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <div className="font-semibold text-gray-900 dark:text-white">{r.user.displayName || r.user.id}</div>
                      <div className="text-sm text-gray-500 dark:text-gray-400">
                        {r.user.twitchUserId || 'N/A'}{r.user.role ? ` • ${r.user.role}` : ''}
                      </div>
                      {r.approvedAt && (
                        <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                          {t('admin.revokedAt', { defaultValue: 'Revoked:' })} {new Date(r.approvedAt).toLocaleString()}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-1 rounded text-xs font-semibold bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200">
                        {t('admin.betaAccessRevokedBadge', { defaultValue: 'revoked' })}
                      </span>
                      <button
                        onClick={() => handleRestore(r.user.id, r.user.displayName)}
                        className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded transition-colors"
                      >
                        {t('admin.restore', { defaultValue: 'Restore' })}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
