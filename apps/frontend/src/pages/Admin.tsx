import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
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

function SavingOverlay({ label }: { label: string }) {
  return (
    <div className="absolute inset-0 z-10 rounded-xl bg-white/55 dark:bg-gray-900/55 backdrop-blur-sm">
      <div className="absolute inset-0 rounded-xl ring-1 ring-black/5 dark:ring-white/10" />
      <div className="flex h-full w-full items-center justify-center p-4">
        <div className="flex items-center gap-3 rounded-xl bg-white/80 dark:bg-gray-900/80 px-4 py-3 shadow-lg ring-1 ring-black/5 dark:ring-white/10">
          <div className="h-4 w-4 rounded-full border-2 border-gray-300 dark:border-gray-600 border-t-primary animate-spin" aria-hidden="true" />
          <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{label}</div>
        </div>
      </div>
    </div>
  );
}

function SavedOverlay({ label }: { label: string }) {
  return (
    <div className="absolute inset-0 z-10 rounded-xl bg-white/45 dark:bg-gray-900/45 backdrop-blur-sm">
      <div className="absolute inset-0 rounded-xl ring-1 ring-black/5 dark:ring-white/10" />
      <div className="flex h-full w-full items-center justify-center p-4">
        <div className="flex items-center gap-3 rounded-xl bg-white/85 dark:bg-gray-900/85 px-4 py-3 shadow-lg ring-1 ring-black/5 dark:ring-white/10">
          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-green-500/15 text-green-600 dark:text-green-300">
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M20 6 9 17l-5-5" />
            </svg>
          </div>
          <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{label}</div>
        </div>
      </div>
    </div>
  );
}

async function ensureMinDuration(startTs: number, minMs: number) {
  const elapsed = Date.now() - startTs;
  const remaining = minMs - elapsed;
  if (remaining > 0) {
    await new Promise((r) => setTimeout(r, remaining));
  }
}

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
  const isStreamerAdmin = user?.role === 'streamer' || user?.role === 'admin';

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

  // Viewers should land on beta access tab in settings.
  useEffect(() => {
    if (user && !isStreamerAdmin && activeTab !== 'beta') {
      setActiveTab('beta');
    }
  }, [user, isStreamerAdmin, activeTab]);

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
          <div className="flex items-center border-b border-secondary/30">
            {/* Tabs scroller (mobile) */}
            <div className="flex-1 overflow-x-auto whitespace-nowrap [-webkit-overflow-scrolling:touch] no-scrollbar">
              <div className="flex gap-2 sm:gap-4 items-center pr-2">
                {isStreamerAdmin && (
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
                )}
                {isStreamerAdmin && (
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
                )}
                {isStreamerAdmin && (
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
                )}
              </div>
            </div>

            {/* More menu (fixed on the right) */}
            <div className="relative flex-shrink-0 pl-2">
              <button
                onClick={() => setIsMoreMenuOpen(!isMoreMenuOpen)}
                className={`pb-2 px-3 transition-colors flex items-center gap-1 ${
                  ['wallets', 'promotions', 'statistics', 'beta'].includes(activeTab)
                    ? 'border-b-2 border-primary text-primary'
                    : 'text-gray-600 dark:text-gray-400 hover:text-primary dark:hover:text-primary'
                }`}
                aria-label={t('admin.more', { defaultValue: 'More' })}
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <circle cx="5" cy="12" r="1.8" />
                  <circle cx="12" cy="12" r="1.8" />
                  <circle cx="19" cy="12" r="1.8" />
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

                    {isStreamerAdmin && (
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

        {activeTab === 'settings' && isStreamerAdmin && (
          <ChannelSettings />
        )}

        {activeTab === 'rewards' && isStreamerAdmin && (
          <RewardsSettings />
        )}

        {activeTab === 'obs' && isStreamerAdmin && (
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

        {activeTab === 'beta' && (
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

function ObsLinksSettings() {
  const { t } = useTranslation();
  const { user } = useAppSelector((state) => state.auth);

  const channelSlug = user?.channel?.slug || '';
  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  const [overlayToken, setOverlayToken] = useState<string>('');
  const [loadingToken, setLoadingToken] = useState(false);
  const [previewMemes, setPreviewMemes] = useState<Array<{ fileUrl: string; type: string; title?: string }>>([]);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [previewLoopEnabled, setPreviewLoopEnabled] = useState<boolean>(true);
  const [advancedTab, setAdvancedTab] = useState<'layout' | 'animation' | 'shadow' | 'border' | 'glass' | 'sender'>('layout');
  const [previewSeed, setPreviewSeed] = useState<number>(1);
  const previewIframeRef = useRef<HTMLIFrameElement | null>(null);

  const [overlayMode, setOverlayMode] = useState<'queue' | 'simultaneous'>('queue');
  const [overlayShowSender, setOverlayShowSender] = useState(false);
  const [overlayMaxConcurrent, setOverlayMaxConcurrent] = useState<number>(3);
  const [loadingOverlaySettings, setLoadingOverlaySettings] = useState(false);
  const [savingOverlaySettings, setSavingOverlaySettings] = useState(false);
  const [overlaySettingsSavedPulse, setOverlaySettingsSavedPulse] = useState(false);
  const [rotatingOverlayToken, setRotatingOverlayToken] = useState(false);
  const overlaySettingsLoadedRef = useRef<string | null>(null);
  const [lastSavedOverlaySettingsPayload, setLastSavedOverlaySettingsPayload] = useState<string | null>(null);
  const lastChangeRef = useRef<'mode' | 'sender' | null>(null);

  useEffect(() => {
    // If sender settings tab is not applicable, fall back to a safe tab.
    if (advancedTab === 'sender' && !overlayShowSender) setAdvancedTab('layout');
  }, [advancedTab, overlayShowSender]);

  // Advanced overlay style (saved server-side; OBS link stays constant).
  const [urlPosition, setUrlPosition] = useState<'random' | 'center' | 'top' | 'bottom' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'>(
    'random'
  );
  const [urlVolume, setUrlVolume] = useState<number>(1);
  const [scaleMode, setScaleMode] = useState<'fixed' | 'range'>('fixed');
  const [scaleFixed, setScaleFixed] = useState<number>(1);
  const [scaleMin, setScaleMin] = useState<number>(0.7);
  const [scaleMax, setScaleMax] = useState<number>(1);
  const [urlRadius, setUrlRadius] = useState<number>(20);
  const [urlBlur, setUrlBlur] = useState<number>(6);
  const [urlBorder, setUrlBorder] = useState<number>(2);
  // Glass (foreground overlay in the overlay itself)
  const [glassEnabled, setGlassEnabled] = useState<boolean>(false);
  const [glassPreset, setGlassPreset] = useState<'ios' | 'clear' | 'prism'>('ios');
  const [glassTintColor, setGlassTintColor] = useState<string>('#7dd3fc');
  const [glassTintStrength, setGlassTintStrength] = useState<number>(0.22);
  // Border
  const [borderPreset, setBorderPreset] = useState<'custom' | 'glass' | 'glow' | 'frosted'>('custom');
  const [borderTintColor, setBorderTintColor] = useState<string>('#7dd3fc');
  const [borderTintStrength, setBorderTintStrength] = useState<number>(0.35);
  const [borderMode, setBorderMode] = useState<'solid' | 'gradient'>('solid');
  const [urlBorderColor, setUrlBorderColor] = useState<string>('#ffffff');
  const [urlBorderColor2, setUrlBorderColor2] = useState<string>('#00e5ff');
  const [urlBorderGradientAngle, setUrlBorderGradientAngle] = useState<number>(135);
  // Shadow (back-compat: previous "Shadow" slider maps to shadowBlur)
  const [shadowBlur, setShadowBlur] = useState<number>(70);
  const [shadowSpread, setShadowSpread] = useState<number>(0);
  const [shadowDistance, setShadowDistance] = useState<number>(22);
  const [shadowAngle, setShadowAngle] = useState<number>(90);
  const [shadowOpacity, setShadowOpacity] = useState<number>(0.6);
  const [shadowColor, setShadowColor] = useState<string>('#000000');
  const [urlBgOpacity, setUrlBgOpacity] = useState<number>(0.18);
  const [urlAnim, setUrlAnim] = useState<'fade' | 'zoom' | 'slide-up' | 'pop' | 'lift' | 'none'>('fade');
  const [animEasingPreset, setAnimEasingPreset] = useState<'ios' | 'smooth' | 'snappy' | 'linear' | 'custom'>('ios');
  const [animEasingX1, setAnimEasingX1] = useState<number>(0.22);
  const [animEasingY1, setAnimEasingY1] = useState<number>(1);
  const [animEasingX2, setAnimEasingX2] = useState<number>(0.36);
  const [animEasingY2, setAnimEasingY2] = useState<number>(1);
  // Slightly slower "Apple-ish" defaults (less snappy, more premium).
  const [urlEnterMs, setUrlEnterMs] = useState<number>(420);
  const [urlExitMs, setUrlExitMs] = useState<number>(320);
  const [senderFontSize, setSenderFontSize] = useState<number>(13);
  const [senderFontWeight, setSenderFontWeight] = useState<number>(600);
  const [senderFontFamily, setSenderFontFamily] = useState<
    'system' | 'inter' | 'roboto' | 'montserrat' | 'poppins' | 'oswald' | 'raleway' | 'nunito' | 'playfair' | 'jetbrains-mono' | 'mono' | 'serif'
  >('system');
  const [senderFontColor, setSenderFontColor] = useState<string>('#ffffff');
  const [senderHoldMs, setSenderHoldMs] = useState<number>(1200);
  const [senderBgColor, setSenderBgColor] = useState<string>('#000000');
  const [senderBgOpacity, setSenderBgOpacity] = useState<number>(0.62);
  const [senderBgRadius, setSenderBgRadius] = useState<number>(999);
  const [senderStroke, setSenderStroke] = useState<'none' | 'glass' | 'solid'>('glass');
  const [senderStrokeWidth, setSenderStrokeWidth] = useState<number>(1);
  const [senderStrokeOpacity, setSenderStrokeOpacity] = useState<number>(0.22);
  const [senderStrokeColor, setSenderStrokeColor] = useState<string>('#ffffff');

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

  useEffect(() => {
    if (!channelSlug) return;
    let mounted = true;
    (async () => {
      try {
        setLoadingToken(true);
        setLoadingOverlaySettings(true);
        const { api } = await import('../lib/api');
        const resp = await api.get<{ token: string; overlayMode?: string; overlayShowSender?: boolean; overlayMaxConcurrent?: number; overlayStyleJson?: string | null }>(
          '/admin/overlay/token'
        );
        if (!mounted) return;
        setOverlayToken(resp.token || '');

        const nextMode = resp.overlayMode === 'simultaneous' ? 'simultaneous' : 'queue';
        const nextShowSender = Boolean(resp.overlayShowSender);
        const nextMax = typeof resp.overlayMaxConcurrent === 'number' ? Math.min(5, Math.max(1, resp.overlayMaxConcurrent)) : 3;

        setOverlayMode(nextMode);
        setOverlayShowSender(nextShowSender);
        setOverlayMaxConcurrent(nextMax);

        // Hydrate advanced style if present
        let styleFromServer: any = null;
        if (resp.overlayStyleJson) {
          try {
            const j = JSON.parse(resp.overlayStyleJson) as any;
            styleFromServer = j && typeof j === 'object' ? j : null;
          } catch {
            styleFromServer = null;
          }
        }

        const nextPosition = styleFromServer?.position ?? urlPosition;
        const nextVolume = typeof styleFromServer?.volume === 'number' ? styleFromServer.volume : urlVolume;
        const nextScaleMode: 'fixed' | 'range' = styleFromServer?.scaleMode === 'range' ? 'range' : 'fixed';
        const nextScaleFixed = typeof styleFromServer?.scaleFixed === 'number' ? styleFromServer.scaleFixed : scaleFixed;
        const nextScaleMin = typeof styleFromServer?.scaleMin === 'number' ? styleFromServer.scaleMin : scaleMin;
        const nextScaleMax = typeof styleFromServer?.scaleMax === 'number' ? styleFromServer.scaleMax : scaleMax;
        const nextRadius = typeof styleFromServer?.radius === 'number' ? styleFromServer.radius : urlRadius;
        const nextShadowBlur = typeof styleFromServer?.shadowBlur === 'number'
          ? styleFromServer.shadowBlur
          : typeof styleFromServer?.shadow === 'number'
            ? styleFromServer.shadow
            : shadowBlur;
        const nextShadowSpread = typeof styleFromServer?.shadowSpread === 'number' ? styleFromServer.shadowSpread : shadowSpread;
        const nextShadowDistance = typeof styleFromServer?.shadowDistance === 'number' ? styleFromServer.shadowDistance : shadowDistance;
        const nextShadowAngle = typeof styleFromServer?.shadowAngle === 'number' ? styleFromServer.shadowAngle : shadowAngle;
        const nextShadowOpacity = typeof styleFromServer?.shadowOpacity === 'number' ? styleFromServer.shadowOpacity : shadowOpacity;
        const nextShadowColor = typeof styleFromServer?.shadowColor === 'string' ? styleFromServer.shadowColor : shadowColor;
        const nextBlur = typeof styleFromServer?.blur === 'number' ? styleFromServer.blur : urlBlur;
        const nextBorder = typeof styleFromServer?.border === 'number' ? styleFromServer.border : urlBorder;
        const nextBorderPreset: 'custom' | 'glass' | 'glow' | 'frosted' =
          styleFromServer?.borderPreset === 'glass'
            ? 'glass'
            : styleFromServer?.borderPreset === 'glow'
              ? 'glow'
              : styleFromServer?.borderPreset === 'frosted'
                ? 'frosted'
                : 'custom';
        const nextBorderTintColor = typeof styleFromServer?.borderTintColor === 'string' ? styleFromServer.borderTintColor : borderTintColor;
        const nextBorderTintStrength =
          typeof styleFromServer?.borderTintStrength === 'number' ? styleFromServer.borderTintStrength : borderTintStrength;
        const nextBorderMode: 'solid' | 'gradient' = styleFromServer?.borderMode === 'gradient' ? 'gradient' : 'solid';
        const nextBorderColor = typeof styleFromServer?.borderColor === 'string' ? styleFromServer.borderColor : urlBorderColor;
        const nextBorderColor2 = typeof styleFromServer?.borderColor2 === 'string' ? styleFromServer.borderColor2 : urlBorderColor2;
        const nextBorderGradientAngle = typeof styleFromServer?.borderGradientAngle === 'number'
          ? styleFromServer.borderGradientAngle
          : urlBorderGradientAngle;
        const nextBgOpacity = typeof styleFromServer?.bgOpacity === 'number' ? styleFromServer.bgOpacity : urlBgOpacity;
        const nextAnim = styleFromServer?.anim ?? urlAnim;
        const nextEnterMs = typeof styleFromServer?.enterMs === 'number' ? styleFromServer.enterMs : urlEnterMs;
        const nextExitMs = typeof styleFromServer?.exitMs === 'number' ? styleFromServer.exitMs : urlExitMs;
        const nextEasingPreset: 'ios' | 'smooth' | 'snappy' | 'linear' | 'custom' =
          styleFromServer?.easing === 'custom'
            ? 'custom'
            : styleFromServer?.easing === 'smooth'
              ? 'smooth'
              : styleFromServer?.easing === 'snappy'
                ? 'snappy'
                : styleFromServer?.easing === 'linear'
                  ? 'linear'
                  : 'ios';
        const nextEasingX1 = typeof styleFromServer?.easingX1 === 'number' ? styleFromServer.easingX1 : animEasingX1;
        const nextEasingY1 = typeof styleFromServer?.easingY1 === 'number' ? styleFromServer.easingY1 : animEasingY1;
        const nextEasingX2 = typeof styleFromServer?.easingX2 === 'number' ? styleFromServer.easingX2 : animEasingX2;
        const nextEasingY2 = typeof styleFromServer?.easingY2 === 'number' ? styleFromServer.easingY2 : animEasingY2;
        const nextSenderFontSize = typeof styleFromServer?.senderFontSize === 'number' ? styleFromServer.senderFontSize : senderFontSize;
        const nextSenderFontWeight = typeof styleFromServer?.senderFontWeight === 'number' ? styleFromServer.senderFontWeight : senderFontWeight;
        const nextSenderFontFamily = typeof styleFromServer?.senderFontFamily === 'string' ? styleFromServer.senderFontFamily : senderFontFamily;
        const nextSenderFontColor = typeof styleFromServer?.senderFontColor === 'string' ? styleFromServer.senderFontColor : senderFontColor;
        const nextSenderHoldMs = typeof styleFromServer?.senderHoldMs === 'number' ? styleFromServer.senderHoldMs : senderHoldMs;
        const nextSenderBgColor = typeof styleFromServer?.senderBgColor === 'string' ? styleFromServer.senderBgColor : senderBgColor;
        const nextSenderBgOpacity = typeof styleFromServer?.senderBgOpacity === 'number' ? styleFromServer.senderBgOpacity : senderBgOpacity;
        const nextSenderBgRadius = typeof styleFromServer?.senderBgRadius === 'number' ? styleFromServer.senderBgRadius : senderBgRadius;
        const nextSenderStroke: 'none' | 'glass' | 'solid' =
          styleFromServer?.senderStroke === 'none' ? 'none' : styleFromServer?.senderStroke === 'solid' ? 'solid' : 'glass';
        const nextSenderStrokeWidth = typeof styleFromServer?.senderStrokeWidth === 'number' ? styleFromServer.senderStrokeWidth : senderStrokeWidth;
        const nextSenderStrokeOpacity =
          typeof styleFromServer?.senderStrokeOpacity === 'number' ? styleFromServer.senderStrokeOpacity : senderStrokeOpacity;
        const nextSenderStrokeColor =
          typeof styleFromServer?.senderStrokeColor === 'string' ? styleFromServer.senderStrokeColor : senderStrokeColor;

        const nextGlassEnabled =
          typeof styleFromServer?.glass === 'boolean'
            ? styleFromServer.glass
            : typeof styleFromServer?.glass === 'number'
              ? styleFromServer.glass === 1
              : typeof styleFromServer?.glassEnabled === 'boolean'
                ? styleFromServer.glassEnabled
                : typeof styleFromServer?.glassEnabled === 'number'
                  ? styleFromServer.glassEnabled === 1
                  : nextBlur > 0 || nextBgOpacity > 0;
        const nextGlassPreset: 'ios' | 'clear' | 'prism' =
          styleFromServer?.glassPreset === 'clear' ? 'clear' : styleFromServer?.glassPreset === 'prism' ? 'prism' : 'ios';
        const nextGlassTintColor = typeof styleFromServer?.glassTintColor === 'string' ? styleFromServer.glassTintColor : glassTintColor;
        const nextGlassTintStrength =
          typeof styleFromServer?.glassTintStrength === 'number' ? styleFromServer.glassTintStrength : glassTintStrength;

        setUrlPosition(nextPosition);
        setUrlVolume(nextVolume);
        setScaleMode(nextScaleMode);
        setScaleFixed(nextScaleFixed);
        setScaleMin(nextScaleMin);
        setScaleMax(nextScaleMax);
        setUrlRadius(nextRadius);
        setShadowBlur(nextShadowBlur);
        setShadowSpread(nextShadowSpread);
        setShadowDistance(nextShadowDistance);
        setShadowAngle(nextShadowAngle);
        setShadowOpacity(nextShadowOpacity);
        setShadowColor(nextShadowColor);
        setUrlBlur(nextBlur);
        setUrlBorder(nextBorder);
        setBorderPreset(nextBorderPreset);
        setBorderTintColor(String(nextBorderTintColor || '#7dd3fc').toLowerCase());
        setBorderTintStrength(nextBorderTintStrength);
        setBorderMode(nextBorderMode);
        setUrlBorderColor(nextBorderColor);
        setUrlBorderColor2(nextBorderColor2);
        setUrlBorderGradientAngle(nextBorderGradientAngle);
        setUrlBgOpacity(nextBgOpacity);
        setUrlAnim(nextAnim);
        setUrlEnterMs(nextEnterMs);
        setUrlExitMs(nextExitMs);
        setAnimEasingPreset(nextEasingPreset);
        setAnimEasingX1(nextEasingX1);
        setAnimEasingY1(nextEasingY1);
        setAnimEasingX2(nextEasingX2);
        setAnimEasingY2(nextEasingY2);
        setSenderFontSize(nextSenderFontSize);
        setSenderFontWeight(nextSenderFontWeight);
        setSenderFontFamily(nextSenderFontFamily);
        setSenderFontColor(String(nextSenderFontColor || '#ffffff').toLowerCase());
        setSenderHoldMs(nextSenderHoldMs);
        setSenderBgColor(String(nextSenderBgColor || '#000000').toLowerCase());
        setSenderBgOpacity(nextSenderBgOpacity);
        setSenderBgRadius(nextSenderBgRadius);
        setSenderStroke(nextSenderStroke);
        setSenderStrokeWidth(nextSenderStrokeWidth);
        setSenderStrokeOpacity(nextSenderStrokeOpacity);
        setSenderStrokeColor(String(nextSenderStrokeColor || '#ffffff').toLowerCase());
        setGlassEnabled(Boolean(nextGlassEnabled));
        setGlassPreset(nextGlassPreset);
        setGlassTintColor(String(nextGlassTintColor || '#7dd3fc').toLowerCase());
        setGlassTintStrength(nextGlassTintStrength);

        // Establish baseline so opening the page never triggers auto-save.
        const overlayStyleJsonBaseline = JSON.stringify({
          position: nextPosition,
          volume: nextVolume,
          scaleMode: nextScaleMode,
          scaleFixed: nextScaleFixed,
          scaleMin: nextScaleMin,
          scaleMax: nextScaleMax,
          radius: nextRadius,
          shadowBlur: nextShadowBlur,
          shadowSpread: nextShadowSpread,
          shadowDistance: nextShadowDistance,
          shadowAngle: nextShadowAngle,
          shadowOpacity: nextShadowOpacity,
          shadowColor: nextShadowColor,
          glass: Boolean(nextGlassEnabled),
          glassPreset: nextGlassPreset,
          glassTintColor: nextGlassTintColor,
          glassTintStrength: nextGlassTintStrength,
          blur: nextBlur,
          border: nextBorder,
          borderPreset: nextBorderPreset,
          borderTintColor: nextBorderTintColor,
          borderTintStrength: nextBorderTintStrength,
          borderMode: nextBorderMode,
          borderColor: nextBorderColor,
          borderColor2: nextBorderColor2,
          borderGradientAngle: nextBorderGradientAngle,
          bgOpacity: nextBgOpacity,
          anim: nextAnim,
          enterMs: nextEnterMs,
          exitMs: nextExitMs,
          easing: nextEasingPreset,
          easingX1: nextEasingX1,
          easingY1: nextEasingY1,
          easingX2: nextEasingX2,
          easingY2: nextEasingY2,
          senderFontSize: nextSenderFontSize,
          senderFontWeight: nextSenderFontWeight,
          senderFontFamily: nextSenderFontFamily,
          senderFontColor: nextSenderFontColor,
          senderHoldMs: nextSenderHoldMs,
          senderBgColor: nextSenderBgColor,
          senderBgOpacity: nextSenderBgOpacity,
          senderBgRadius: nextSenderBgRadius,
          senderStroke: nextSenderStroke,
          senderStrokeWidth: nextSenderStrokeWidth,
          senderStrokeOpacity: nextSenderStrokeOpacity,
          senderStrokeColor: nextSenderStrokeColor,
        });
        const baselinePayload = JSON.stringify({
          overlayMode: nextMode,
          overlayShowSender: nextShowSender,
          overlayMaxConcurrent: nextMax,
          overlayStyleJson: overlayStyleJsonBaseline,
        });
        setLastSavedOverlaySettingsPayload(baselinePayload);
        overlaySettingsLoadedRef.current = channelSlug;
        lastChangeRef.current = null;
      } catch (e) {
        if (mounted) setOverlayToken('');
      } finally {
        if (mounted) setLoadingToken(false);
        if (mounted) setLoadingOverlaySettings(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [channelSlug]);

  const previewCount = useMemo(
    () => (overlayMode === 'queue' ? 1 : Math.min(5, Math.max(1, overlayMaxConcurrent))),
    [overlayMaxConcurrent, overlayMode]
  );

  const fetchPreviewMemes = useCallback(async (count?: number) => {
    const n = Math.min(5, Math.max(1, Number.isFinite(count) ? Number(count) : previewCount));
    try {
      setLoadingPreview(true);
      const { api } = await import('../lib/api');
      const results = await Promise.all(
        Array.from({ length: n }).map(async () => {
          try {
            const resp = await api.get<{ meme: null | { fileUrl: string; type: string; title?: string } }>(
              '/admin/overlay/preview-meme'
            );
            return resp?.meme || null;
          } catch {
            return null;
          }
        })
      );
      // Keep unique-by-fileUrl, preserve order.
      const uniq: Array<{ fileUrl: string; type: string; title?: string }> = [];
      const seen = new Set<string>();
      for (const m of results) {
        if (!m?.fileUrl) continue;
        if (seen.has(m.fileUrl)) continue;
        seen.add(m.fileUrl);
        uniq.push(m);
      }
      setPreviewMemes(uniq);
    } catch {
      setPreviewMemes([]);
    } finally {
      setLoadingPreview(false);
    }
  }, [previewCount]);

  useEffect(() => {
    if (!channelSlug) return;
    void fetchPreviewMemes(previewCount);
  }, [channelSlug, fetchPreviewMemes, previewCount]);

  // Overlay is deployed under /overlay/ and expects /overlay/t/:token
  const overlayUrl = overlayToken ? `${origin}/overlay/t/${overlayToken}` : '';

  // OBS URL should stay constant.
  const overlayUrlWithDefaults = overlayUrl;

  // Preview iframe URL should be stable while tweaking sliders (avoid network reloads).
  // We only change iframe src when the actual preview media changes (Next meme).
  const overlayPreviewBaseUrl = useMemo(() => {
    if (!overlayUrl) return '';
    const u = new URL(overlayUrl);
    u.searchParams.set('demo', '1');
    u.searchParams.set('seed', String(previewSeed));
    // Multi-meme preview: pass up to 5 urls/types (overlay uses getAll()).
    u.searchParams.delete('previewUrl');
    u.searchParams.delete('previewType');
    const target = Math.min(5, Math.max(1, previewCount));
    const pool = previewMemes.length > 0 ? previewMemes : [];
    for (let i = 0; i < target; i++) {
      const m = pool[i % Math.max(1, pool.length)];
      if (m?.fileUrl) u.searchParams.append('previewUrl', m.fileUrl);
      if (m?.type) u.searchParams.append('previewType', m.type);
    }
    return u.toString();
  }, [overlayUrl, previewCount, previewMemes, previewSeed]);

  const overlayPreviewParams = useMemo(() => {
    // These values are pushed into the iframe via postMessage to avoid reloading.
    const p: Record<string, string> = {
      demo: '1',
      seed: String(previewSeed),
      position: urlPosition,
      previewCount: String(previewCount),
      previewMode: overlayMode,
      repeat: previewLoopEnabled ? '1' : '0',
      volume: String(urlVolume),
      anim: urlAnim,
      enterMs: String(urlEnterMs),
      exitMs: String(urlExitMs),
      radius: String(urlRadius),
      shadowBlur: String(shadowBlur),
      shadowSpread: String(shadowSpread),
      shadowDistance: String(shadowDistance),
      shadowAngle: String(shadowAngle),
      shadowOpacity: String(shadowOpacity),
      shadowColor: String(shadowColor),
      glass: glassEnabled ? '1' : '0',
      glassPreset,
      glassTintColor: String(glassTintColor),
      glassTintStrength: String(glassTintStrength),
      blur: String(urlBlur),
      border: String(urlBorder),
      borderPreset,
      borderTintColor: String(borderTintColor),
      borderTintStrength: String(borderTintStrength),
      borderMode,
      borderColor: String(urlBorderColor),
      borderColor2: String(urlBorderColor2),
      borderGradientAngle: String(urlBorderGradientAngle),
      bgOpacity: String(urlBgOpacity),
      senderHoldMs: String(senderHoldMs),
      senderBgColor: String(senderBgColor),
      senderBgOpacity: String(senderBgOpacity),
      senderBgRadius: String(senderBgRadius),
      senderStroke,
      senderStrokeWidth: String(senderStrokeWidth),
      senderStrokeOpacity: String(senderStrokeOpacity),
      senderStrokeColor: String(senderStrokeColor),
      easing: animEasingPreset,
      easingX1: String(animEasingX1),
      easingY1: String(animEasingY1),
      easingX2: String(animEasingX2),
      easingY2: String(animEasingY2),
      showSender: overlayShowSender ? '1' : '0',
      senderFontSize: String(senderFontSize),
      senderFontWeight: String(senderFontWeight),
      senderFontFamily: String(senderFontFamily),
      senderFontColor: String(senderFontColor),
      scaleMode,
    };
    if (scaleMode === 'fixed') {
      p.scaleFixed = String(scaleFixed);
      p.scale = String(scaleFixed);
    } else {
      p.scaleMin = String(scaleMin);
      p.scaleMax = String(scaleMax);
    }
    return p;
  }, [
    borderPreset,
    borderTintColor,
    borderTintStrength,
    borderMode,
    glassEnabled,
    glassPreset,
    glassTintColor,
    glassTintStrength,
    overlayMode,
    previewCount,
    previewLoopEnabled,
    previewSeed,
    scaleFixed,
    scaleMax,
    scaleMin,
    scaleMode,
    senderBgColor,
    senderBgOpacity,
    senderBgRadius,
    senderStroke,
    senderStrokeWidth,
    senderStrokeOpacity,
    senderStrokeColor,
    overlayShowSender,
    senderFontFamily,
    senderFontSize,
    senderFontWeight,
    senderHoldMs,
    shadowAngle,
    shadowBlur,
    shadowColor,
    shadowDistance,
    shadowOpacity,
    shadowSpread,
    urlAnim,
    urlBgOpacity,
    urlBlur,
    urlBorder,
    urlBorderColor,
    urlBorderColor2,
    urlBorderGradientAngle,
    urlEnterMs,
    urlExitMs,
    urlPosition,
    urlRadius,
    urlVolume,
  ]);

  const postPreviewParams = useCallback(() => {
    const win = previewIframeRef.current?.contentWindow;
    if (!win) return;
    try {
      win.postMessage({ type: 'memalerts:overlayParams', params: overlayPreviewParams }, window.location.origin);
    } catch {
      // ignore
    }
  }, [overlayPreviewParams]);

  useEffect(() => {
    postPreviewParams();
  }, [postPreviewParams]);

  const animSpeedPct = useMemo(() => {
    const slow = 800;
    const fast = 180;
    const v = Math.max(0, Math.min(1200, urlEnterMs));
    const pct = Math.round(((slow - v) / (slow - fast)) * 100);
    return Math.max(0, Math.min(100, pct));
  }, [urlEnterMs]);

  const setAnimSpeedPct = (pct: number) => {
    const slow = 800;
    const fast = 180;
    const p = Math.max(0, Math.min(100, pct));
    const enter = Math.round(slow - (p / 100) * (slow - fast));
    const exit = Math.round(enter * 0.75);
    setUrlEnterMs(enter);
    setUrlExitMs(exit);
  };

  const overlayStyleJson = useMemo(() => {
    return JSON.stringify({
      position: urlPosition,
      volume: urlVolume,
      scaleMode,
      scaleFixed,
      scaleMin,
      scaleMax,
      radius: urlRadius,
      shadowBlur,
      shadowSpread,
      shadowDistance,
      shadowAngle,
      shadowOpacity,
      shadowColor,
      glass: glassEnabled,
      glassPreset,
      glassTintColor,
      glassTintStrength,
      blur: urlBlur,
      border: urlBorder,
      borderPreset,
      borderTintColor,
      borderTintStrength,
      borderMode,
      borderColor: urlBorderColor,
      borderColor2: urlBorderColor2,
      borderGradientAngle: urlBorderGradientAngle,
      bgOpacity: urlBgOpacity,
      anim: urlAnim,
      enterMs: urlEnterMs,
      exitMs: urlExitMs,
      easing: animEasingPreset,
      easingX1: animEasingX1,
      easingY1: animEasingY1,
      easingX2: animEasingX2,
      easingY2: animEasingY2,
      senderFontSize,
      senderFontWeight,
      senderFontFamily,
      senderFontColor,
      senderHoldMs,
      senderBgColor,
      senderBgOpacity,
      senderBgRadius,
      senderStroke,
      senderStrokeWidth,
      senderStrokeOpacity,
      senderStrokeColor,
    });
  }, [
    urlPosition,
    urlVolume,
    scaleMode,
    scaleFixed,
    scaleMin,
    scaleMax,
    urlRadius,
    shadowBlur,
    shadowSpread,
    shadowDistance,
    shadowAngle,
    shadowOpacity,
    shadowColor,
    glassEnabled,
    glassPreset,
    glassTintColor,
    glassTintStrength,
    urlBlur,
    urlBorder,
    borderPreset,
    borderTintColor,
    borderTintStrength,
    borderMode,
    urlBorderColor,
    urlBorderColor2,
    urlBorderGradientAngle,
    urlBgOpacity,
    urlAnim,
    urlEnterMs,
    urlExitMs,
    animEasingPreset,
    animEasingX1,
    animEasingY1,
    animEasingX2,
    animEasingY2,
    senderFontSize,
    senderFontWeight,
    senderFontFamily,
    senderFontColor,
    senderHoldMs,
    senderBgColor,
    senderBgOpacity,
    senderBgRadius,
    senderStroke,
    senderStrokeWidth,
    senderStrokeOpacity,
    senderStrokeColor,
  ]);

  const overlaySettingsPayload = useMemo(() => {
    return JSON.stringify({ overlayMode, overlayShowSender, overlayMaxConcurrent, overlayStyleJson });
  }, [overlayMaxConcurrent, overlayMode, overlayShowSender, overlayStyleJson]);

  const overlaySettingsDirty = useMemo(() => {
    if (!overlaySettingsLoadedRef.current) return false;
    if (lastSavedOverlaySettingsPayload === null) return false;
    return overlaySettingsPayload !== lastSavedOverlaySettingsPayload;
  }, [lastSavedOverlaySettingsPayload, overlaySettingsPayload]);

  const handleSaveOverlaySettings = useCallback(async (): Promise<void> => {
    if (!channelSlug) return;
    if (loadingOverlaySettings) return;
    if (!overlaySettingsLoadedRef.current) return;
    if (!overlaySettingsDirty) return;
    const startedAt = Date.now();
    try {
      setSavingOverlaySettings(true);
      const { api } = await import('../lib/api');
      await api.patch('/admin/channel/settings', {
        overlayMode,
        overlayShowSender,
        overlayMaxConcurrent,
        overlayStyleJson,
      });
      setLastSavedOverlaySettingsPayload(overlaySettingsPayload);
      lastChangeRef.current = null;
      // No extra GET here: saving should be a single request for better UX / lower load.
      toast.success(t('admin.settingsSaved', { defaultValue: 'Настройки сохранены!' }));
    } catch (error: unknown) {
      const apiError = error as { response?: { data?: { error?: string } } };
      toast.error(apiError.response?.data?.error || t('admin.failedToSave', { defaultValue: 'Не удалось сохранить' }));
    } finally {
      await ensureMinDuration(startedAt, 650);
      setSavingOverlaySettings(false);
      setOverlaySettingsSavedPulse(true);
      window.setTimeout(() => setOverlaySettingsSavedPulse(false), 700);
    }
  }, [
    channelSlug,
    loadingOverlaySettings,
    overlayMaxConcurrent,
    overlayMode,
    overlaySettingsDirty,
    overlaySettingsPayload,
    overlayShowSender,
    overlayStyleJson,
    t,
  ]);

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
          <div className="flex items-start gap-3">
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
            </label>
          </div>
        </div>

        <details className="glass p-4">
          <summary className="cursor-pointer font-semibold text-gray-900 dark:text-white">
            {t('admin.obsAdvancedOverlayUrl', { defaultValue: 'Advanced overlay URL (customize)' })}
          </summary>
          <div className="mt-3 space-y-4">
            <div className="text-xs text-gray-600 dark:text-gray-300">
              {t('admin.obsOverlayAdvancedHintShort', {
                defaultValue: 'Change the look here — then copy the single overlay URL above into OBS.',
              })}
            </div>

            <div className="relative">
              {(loadingOverlaySettings || savingOverlaySettings) && (
                <SavingOverlay label={t('admin.saving', { defaultValue: 'Сохранение...' })} />
              )}
              {overlaySettingsSavedPulse && !savingOverlaySettings && !loadingOverlaySettings && (
                <SavedOverlay label={t('admin.saved', { defaultValue: 'Сохранено' })} />
              )}

              <div
                className={`space-y-4 transition-opacity ${
                  loadingOverlaySettings || savingOverlaySettings ? 'pointer-events-none opacity-60' : ''
                }`}
              >
                <div className="glass p-4">
                  <div
                    className={`grid grid-cols-1 md:grid-cols-2 gap-4`}
                  >
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                    {t('admin.obsOverlayMode')}
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

                {overlayMode === 'simultaneous' && (
                  <div className="pt-1">
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                      {t('admin.obsOverlayMaxConcurrent', { defaultValue: 'Max simultaneous memes' })}:{' '}
                      <span className="font-mono">{overlayMaxConcurrent}</span>
                    </label>
                    <input
                      type="range"
                      min={1}
                      max={5}
                      step={1}
                      value={overlayMaxConcurrent}
                      onChange={(e) => setOverlayMaxConcurrent(parseInt(e.target.value, 10))}
                      className="w-full"
                    />
                    <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                      {t('admin.obsOverlayMaxConcurrentHint', { defaultValue: 'Safety limit for unlimited mode (prevents OBS from lagging).' })}
                    </div>
                  </div>
                )}
              </div>
                  </div>
                </div>

                <div className="pt-2">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
                      {t('admin.obsOverlayLivePreview', { defaultValue: 'Демонстрация' })}
                    </div>
                    <button
                      type="button"
                      className="glass-btn p-2 shrink-0"
                      disabled={loadingPreview || !overlayToken}
                      onClick={() => {
                        setPreviewSeed((s) => (s >= 1000000000 ? 1 : s + 1));
                        void fetchPreviewMemes(previewCount);
                      }}
                      title={t('admin.obsPreviewNextMeme', { defaultValue: 'Следующий мем' })}
                      aria-label={t('admin.obsPreviewNextMeme', { defaultValue: 'Следующий мем' })}
                    >
                      {/* Next arrow icon */}
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h11" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5-5 5" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      className={`glass-btn p-2 shrink-0 ${previewLoopEnabled ? 'ring-2 ring-primary/40' : ''}`}
                      title={t('admin.obsPreviewLoop', { defaultValue: 'Зациклить' })}
                      aria-label={t('admin.obsPreviewLoop', { defaultValue: 'Зациклить' })}
                      onClick={() => setPreviewLoopEnabled((p) => !p)}
                    >
                      {/* Loop icon */}
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 1l4 4-4 4" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 11V9a4 4 0 014-4h14" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 23l-4-4 4-4" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 13v2a4 4 0 01-4 4H3" />
                      </svg>
                    </button>
                  </div>
                  <div className="rounded-2xl overflow-hidden border border-white/20 dark:border-white/10 bg-black/40">
                    <iframe
                      ref={previewIframeRef}
                      title="Overlay preview"
                      src={overlayPreviewBaseUrl}
                      className="w-full"
                      style={{ aspectRatio: '16 / 9', border: '0' }}
                      allow="autoplay"
                      onLoad={() => postPreviewParams()}
                    />
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <div className="text-xs text-gray-600 dark:text-gray-300 min-w-0">
                      {previewMemes?.[0]?.title ? (
                        <span className="truncate block">
                          {t('admin.obsOverlayPreviewMeme', { defaultValue: 'Preview meme' })}:{' '}
                          <span className="font-mono">{previewMemes[0].title}</span>
                        </span>
                      ) : (
                        <span>
                          {t('admin.obsOverlayLivePreviewHint', {
                            defaultValue:
                              'Preview uses a real random meme when available. Copy the URL above into OBS when ready.',
                          })}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="glass p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 flex-1">
                      {(
                        [
                          ['layout', t('admin.obsAdvancedTabLayout', { defaultValue: 'Layout' })],
                          ['animation', t('admin.obsAdvancedTabAnimation', { defaultValue: 'Animation' })],
                          ['shadow', t('admin.obsAdvancedTabShadow', { defaultValue: 'Shadow' })],
                          ['border', t('admin.obsAdvancedTabBorder', { defaultValue: 'Border' })],
                          ['glass', t('admin.obsAdvancedTabGlass', { defaultValue: 'Glass' })],
                          ['sender', t('admin.obsAdvancedTabSender', { defaultValue: 'Sender' })],
                        ] as const
                      )
                        .filter(([k]) => (k === 'sender' ? overlayShowSender : true))
                        .map(([k, label]) => (
                          <button
                            key={k}
                            type="button"
                            onClick={() => setAdvancedTab(k)}
                            className={`h-11 w-full rounded-xl border text-xs sm:text-sm font-semibold transition-colors ${
                              advancedTab === k
                                ? 'bg-primary text-white border-primary/30 shadow-sm'
                                : 'bg-white/60 dark:bg-white/10 text-gray-900 dark:text-white border-white/30 dark:border-white/10 hover:bg-white/80 dark:hover:bg-white/15'
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {overlaySettingsDirty && (
                        <div className="hidden sm:flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
                          <span className="inline-block h-2 w-2 rounded-full bg-amber-400" />
                          {t('admin.unsavedChanges', { defaultValue: 'Есть несохранённые изменения' })}
                        </div>
                      )}
                      <button
                        type="button"
                        className={`glass-btn px-4 py-2 text-sm font-semibold ${overlaySettingsDirty ? '' : 'opacity-60'}`}
                        disabled={!overlaySettingsDirty || savingOverlaySettings || loadingOverlaySettings}
                        onClick={() => void handleSaveOverlaySettings()}
                      >
                        {savingOverlaySettings
                          ? t('admin.saving', { defaultValue: 'Сохранение...' })
                          : t('common.save', { defaultValue: 'Сохранить' })}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className={advancedTab === 'layout' ? '' : 'hidden'}>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                  {t('admin.obsOverlayPosition', { defaultValue: 'Позиция' })}
                </label>
                <select
                  value={urlPosition}
                  onChange={(e) => setUrlPosition(e.target.value as any)}
                  className="w-full rounded-lg px-3 py-2 bg-white/60 dark:bg-white/10 text-gray-900 dark:text-white shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                >
                  <option value="random">{t('admin.obsOverlayPositionRandom', { defaultValue: 'Случайно' })}</option>
                  <option value="center">{t('admin.obsOverlayPositionCenter', { defaultValue: 'Центр' })}</option>
                  <option value="top">{t('admin.obsOverlayPositionTop', { defaultValue: 'Сверху' })}</option>
                  <option value="bottom">{t('admin.obsOverlayPositionBottom', { defaultValue: 'Снизу' })}</option>
                  <option value="top-left">{t('admin.obsOverlayPositionTopLeft', { defaultValue: 'Слева сверху' })}</option>
                  <option value="top-right">{t('admin.obsOverlayPositionTopRight', { defaultValue: 'Справа сверху' })}</option>
                  <option value="bottom-left">{t('admin.obsOverlayPositionBottomLeft', { defaultValue: 'Слева снизу' })}</option>
                  <option value="bottom-right">{t('admin.obsOverlayPositionBottomRight', { defaultValue: 'Справа снизу' })}</option>
                </select>
              </div>

              <div className={`md:col-span-2 ${advancedTab === 'layout' ? '' : 'hidden'}`}>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-2">
                  {t('admin.obsOverlayScaleMode', { defaultValue: 'Size' })}
                </label>
                <div className="flex items-center gap-3">
                  <select
                    value={scaleMode}
                    onChange={(e) => setScaleMode(e.target.value as any)}
                    className="rounded-lg px-3 py-2 bg-white/60 dark:bg-white/10 text-gray-900 dark:text-white shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                  >
                    <option value="fixed">{t('admin.obsOverlayScaleFixed', { defaultValue: 'Fixed' })}</option>
                    <option value="range">{t('admin.obsOverlayScaleRange', { defaultValue: 'Range' })}</option>
                  </select>

                  {scaleMode === 'fixed' ? (
                    <div className="flex-1">
                      <div className="text-xs text-gray-600 dark:text-gray-300 mb-1">
                        {t('admin.obsOverlayScaleFixedValue', { defaultValue: 'Scale' })}:{' '}
                        <span className="font-mono">{scaleFixed.toFixed(2)}</span>
                      </div>
                      <input
                        type="range"
                        min={0.25}
                        max={2.5}
                        step={0.05}
                        value={scaleFixed}
                        onChange={(e) => setScaleFixed(parseFloat(e.target.value))}
                        className="w-full"
                      />
                    </div>
                  ) : (
                    <div className="flex-1 grid grid-cols-2 gap-3">
                      <div>
                        <div className="text-xs text-gray-600 dark:text-gray-300 mb-1">
                          {t('admin.obsOverlayScaleMin', { defaultValue: 'Min' })}:{' '}
                          <span className="font-mono">{scaleMin.toFixed(2)}</span>
                        </div>
                        <input
                          type="range"
                          min={0.25}
                          max={2.5}
                          step={0.05}
                          value={scaleMin}
                          onChange={(e) => setScaleMin(parseFloat(e.target.value))}
                          className="w-full"
                        />
                      </div>
                      <div>
                        <div className="text-xs text-gray-600 dark:text-gray-300 mb-1">
                          {t('admin.obsOverlayScaleMax', { defaultValue: 'Max' })}:{' '}
                          <span className="font-mono">{scaleMax.toFixed(2)}</span>
                        </div>
                        <input
                          type="range"
                          min={0.25}
                          max={2.5}
                          step={0.05}
                          value={scaleMax}
                          onChange={(e) => setScaleMax(parseFloat(e.target.value))}
                          className="w-full"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className={advancedTab === 'layout' ? '' : 'hidden'}>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                  {t('admin.obsOverlayVolume', { defaultValue: 'Volume' })}: <span className="font-mono">{Math.round(urlVolume * 100)}%</span>
                </label>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={urlVolume}
                  onChange={(e) => setUrlVolume(parseFloat(e.target.value))}
                  className="w-full"
                />
              </div>

              <div className={advancedTab === 'animation' ? '' : 'hidden'}>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                  {t('admin.obsOverlayAnim', { defaultValue: 'Animation' })}
                </label>
                <select
                  value={urlAnim}
                  onChange={(e) => setUrlAnim(e.target.value as any)}
                  className="w-full rounded-lg px-3 py-2 bg-white/60 dark:bg-white/10 text-gray-900 dark:text-white shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                >
                  <option value="fade">{t('admin.obsOverlayAnimFade', { defaultValue: 'Fade' })}</option>
                  <option value="zoom">{t('admin.obsOverlayAnimZoom', { defaultValue: 'Zoom' })}</option>
                  <option value="slide-up">{t('admin.obsOverlayAnimSlideUp', { defaultValue: 'Slide up' })}</option>
                  <option value="pop">{t('admin.obsOverlayAnimPop', { defaultValue: 'Pop (premium)' })}</option>
                  <option value="lift">{t('admin.obsOverlayAnimLift', { defaultValue: 'Lift (premium)' })}</option>
                  <option value="none">{t('admin.obsOverlayAnimNone', { defaultValue: 'None' })}</option>
                </select>
              </div>

              <div className={advancedTab === 'animation' ? '' : 'hidden'}>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                  {t('admin.obsOverlayAnimEasing', { defaultValue: 'Easing' })}
                </label>
                <select
                  value={animEasingPreset}
                  onChange={(e) => setAnimEasingPreset(e.target.value as any)}
                  className="w-full rounded-lg px-3 py-2 bg-white/60 dark:bg-white/10 text-gray-900 dark:text-white shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                >
                  <option value="ios">{t('admin.obsOverlayAnimEasingIos', { defaultValue: 'iOS' })}</option>
                  <option value="smooth">{t('admin.obsOverlayAnimEasingSmooth', { defaultValue: 'Smooth' })}</option>
                  <option value="snappy">{t('admin.obsOverlayAnimEasingSnappy', { defaultValue: 'Snappy' })}</option>
                  <option value="linear">{t('admin.obsOverlayAnimEasingLinear', { defaultValue: 'Linear' })}</option>
                  <option value="custom">{t('admin.obsOverlayAnimEasingCustom', { defaultValue: 'Custom cubic-bezier' })}</option>
                </select>
                <div className="text-xs text-gray-600 dark:text-gray-300 mt-1">
                  {t('admin.obsOverlayAnimEasingHint', { defaultValue: 'Controls the feel of enter/exit. iOS is the recommended default.' })}
                </div>
              </div>

              {animEasingPreset === 'custom' && (
                <div className={`md:col-span-2 ${advancedTab === 'animation' ? '' : 'hidden'}`}>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">x1</label>
                      <input
                        type="number"
                        value={animEasingX1}
                        step={0.01}
                        min={-1}
                        max={2}
                        onChange={(e) => setAnimEasingX1(parseFloat(e.target.value))}
                        className="w-full rounded-lg px-3 py-2 bg-white/60 dark:bg-white/10 text-gray-900 dark:text-white shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">y1</label>
                      <input
                        type="number"
                        value={animEasingY1}
                        step={0.01}
                        min={-1}
                        max={2}
                        onChange={(e) => setAnimEasingY1(parseFloat(e.target.value))}
                        className="w-full rounded-lg px-3 py-2 bg-white/60 dark:bg-white/10 text-gray-900 dark:text-white shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">x2</label>
                      <input
                        type="number"
                        value={animEasingX2}
                        step={0.01}
                        min={-1}
                        max={2}
                        onChange={(e) => setAnimEasingX2(parseFloat(e.target.value))}
                        className="w-full rounded-lg px-3 py-2 bg-white/60 dark:bg-white/10 text-gray-900 dark:text-white shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">y2</label>
                      <input
                        type="number"
                        value={animEasingY2}
                        step={0.01}
                        min={-1}
                        max={2}
                        onChange={(e) => setAnimEasingY2(parseFloat(e.target.value))}
                        className="w-full rounded-lg px-3 py-2 bg-white/60 dark:bg-white/10 text-gray-900 dark:text-white shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                      />
                    </div>
                  </div>
                </div>
              )}

              <div className={advancedTab === 'animation' ? '' : 'hidden'}>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                  {t('admin.obsOverlayAnimSpeed', { defaultValue: 'Animation speed' })}:{' '}
                  <span className="font-mono">{animSpeedPct}%</span>
                </label>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={animSpeedPct}
                  onChange={(e) => setAnimSpeedPct(parseInt(e.target.value, 10))}
                  className="w-full"
                />
              </div>

              <div className={`text-xs text-gray-600 dark:text-gray-300 -mt-2 ${advancedTab === 'animation' ? '' : 'hidden'}`}>
                {t('admin.obsOverlayAnimSpeedHint', { defaultValue: 'Slower looks more premium; faster feels snappier.' })}
              </div>

              <div className={advancedTab === 'layout' ? '' : 'hidden'}>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                  {t('admin.obsOverlayRadius', { defaultValue: 'Corner radius' })}: <span className="font-mono">{urlRadius}</span>
                </label>
                <input
                  type="range"
                  min={0}
                  max={80}
                  step={1}
                  value={urlRadius}
                  onChange={(e) => setUrlRadius(parseInt(e.target.value, 10))}
                  className="w-full"
                />
              </div>

              <div className={advancedTab === 'shadow' ? '' : 'hidden'}>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                  {t('admin.obsOverlayShadow', { defaultValue: 'Shadow' })}: <span className="font-mono">{shadowBlur}</span>
                </label>
                <input
                  type="range"
                  min={0}
                  max={200}
                  step={2}
                  value={shadowBlur}
                  onChange={(e) => setShadowBlur(parseInt(e.target.value, 10))}
                  className="w-full"
                />
              </div>

              <div className={advancedTab === 'shadow' ? '' : 'hidden'}>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                  {t('admin.obsOverlayShadowAngle', { defaultValue: 'Shadow direction' })}:{' '}
                  <span className="font-mono">{Math.round(shadowAngle)}°</span>
                </label>
                <input
                  type="range"
                  min={0}
                  max={360}
                  step={1}
                  value={shadowAngle}
                  onChange={(e) => setShadowAngle(parseInt(e.target.value, 10))}
                  className="w-full"
                />
              </div>

              <div className={advancedTab === 'shadow' ? '' : 'hidden'}>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                  {t('admin.obsOverlayShadowDistance', { defaultValue: 'Shadow distance' })}:{' '}
                  <span className="font-mono">{shadowDistance}px</span>
                </label>
                <input
                  type="range"
                  min={0}
                  max={120}
                  step={1}
                  value={shadowDistance}
                  onChange={(e) => setShadowDistance(parseInt(e.target.value, 10))}
                  className="w-full"
                />
              </div>

              <div className={advancedTab === 'shadow' ? '' : 'hidden'}>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                  {t('admin.obsOverlayShadowSpread', { defaultValue: 'Shadow spread' })}:{' '}
                  <span className="font-mono">{shadowSpread}px</span>
                </label>
                <input
                  type="range"
                  min={0}
                  max={120}
                  step={1}
                  value={shadowSpread}
                  onChange={(e) => setShadowSpread(parseInt(e.target.value, 10))}
                  className="w-full"
                />
              </div>

              <div className={advancedTab === 'shadow' ? '' : 'hidden'}>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                  {t('admin.obsOverlayShadowOpacity', { defaultValue: 'Shadow opacity' })}:{' '}
                  <span className="font-mono">{Math.round(shadowOpacity * 100)}%</span>
                </label>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.02}
                  value={shadowOpacity}
                  onChange={(e) => setShadowOpacity(parseFloat(e.target.value))}
                  className="w-full"
                />
              </div>

              <div className={advancedTab === 'shadow' ? '' : 'hidden'}>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                  {t('admin.obsOverlayShadowColor', { defaultValue: 'Shadow color' })}
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="color"
                    value={shadowColor}
                    onChange={(e) => setShadowColor(String(e.target.value || '').toLowerCase())}
                    className="h-10 w-14 rounded-lg border border-white/20 dark:border-white/10 bg-transparent"
                    aria-label={t('admin.obsOverlayShadowColor', { defaultValue: 'Shadow color' })}
                  />
                  <div className="text-xs text-gray-600 dark:text-gray-300 font-mono">{shadowColor}</div>
                </div>
              </div>

              <div className={advancedTab === 'glass' ? '' : 'hidden'}>
                <div className="flex items-center justify-between gap-3 mb-2">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-200">
                    {t('admin.obsOverlayGlassEnabled', { defaultValue: 'Glass' })}
                  </label>
                  <button
                    type="button"
                    onClick={() => setGlassEnabled((v) => !v)}
                    className={`glass-btn px-3 py-1.5 text-sm font-semibold ${glassEnabled ? 'ring-2 ring-primary/40' : 'opacity-70'}`}
                  >
                    {glassEnabled ? t('common.on', { defaultValue: 'On' }) : t('common.off', { defaultValue: 'Off' })}
                  </button>
                </div>

                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                  {t('admin.obsOverlayGlassStyle', { defaultValue: 'Glass style' })}
                </label>
                <select
                  value={glassPreset}
                  onChange={(e) => setGlassPreset(e.target.value as any)}
                  disabled={!glassEnabled}
                  className="w-full rounded-lg px-3 py-2 bg-white/60 dark:bg-white/10 text-gray-900 dark:text-white shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-50"
                >
                  <option value="ios">{t('admin.obsOverlayGlassPresetIos', { defaultValue: 'iOS (shine)' })}</option>
                  <option value="clear">{t('admin.obsOverlayGlassPresetClear', { defaultValue: 'Clear' })}</option>
                  <option value="prism">{t('admin.obsOverlayGlassPresetPrism', { defaultValue: 'Prism' })}</option>
                </select>
              </div>

              <div className={advancedTab === 'glass' ? '' : 'hidden'}>
                <div className="glass p-3">
                  <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">
                    {t('admin.obsOverlayGlassPresetControls', { defaultValue: 'Preset controls' })}
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                        {t('admin.obsOverlayGlassTintColor', { defaultValue: 'Tint color' })}
                      </label>
                      <div className="flex items-center gap-3">
                        <input
                          type="color"
                          value={glassTintColor}
                          onChange={(e) => setGlassTintColor(String(e.target.value || '').toLowerCase())}
                          disabled={!glassEnabled}
                          className="h-10 w-14 rounded-lg border border-white/20 dark:border-white/10 bg-transparent disabled:opacity-50"
                        />
                        <div className="text-xs text-gray-600 dark:text-gray-300 font-mono">{glassTintColor}</div>
                      </div>
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                        {t('admin.obsOverlayGlassTintStrength', { defaultValue: 'Tint strength' })}:{' '}
                        <span className="font-mono">{Math.round(glassTintStrength * 100)}%</span>
                      </label>
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.02}
                        value={glassTintStrength}
                        onChange={(e) => setGlassTintStrength(parseFloat(e.target.value))}
                        disabled={!glassEnabled}
                        className="w-full disabled:opacity-50"
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className={advancedTab === 'glass' ? '' : 'hidden'}>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                  {t('admin.obsOverlayBlur', { defaultValue: 'Glass blur' })}: <span className="font-mono">{urlBlur}px</span>
                </label>
                <input
                  type="range"
                  min={0}
                  max={40}
                  step={1}
                  value={urlBlur}
                  onChange={(e) => setUrlBlur(parseInt(e.target.value, 10))}
                  disabled={!glassEnabled}
                  className="w-full disabled:opacity-50"
                />
              </div>

              <div className={advancedTab === 'border' ? '' : 'hidden'}>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                  {t('admin.obsOverlayBorderPreset', { defaultValue: 'Frame style' })}
                </label>
                <select
                  value={borderPreset}
                  onChange={(e) => setBorderPreset(e.target.value as any)}
                  className="w-full rounded-lg px-3 py-2 bg-white/60 dark:bg-white/10 text-gray-900 dark:text-white shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                >
                  <option value="custom">{t('admin.obsOverlayBorderPresetCustom', { defaultValue: 'Custom' })}</option>
                  <option value="glass">{t('admin.obsOverlayBorderPresetGlass', { defaultValue: 'Glass frame' })}</option>
                  <option value="glow">{t('admin.obsOverlayBorderPresetGlow', { defaultValue: 'Glow' })}</option>
                  <option value="frosted">{t('admin.obsOverlayBorderPresetFrosted', { defaultValue: 'Frosted edge' })}</option>
                </select>
                <div className="text-xs text-gray-600 dark:text-gray-300 mt-1">
                  {t('admin.obsOverlayBorderPresetHint', { defaultValue: 'Presets override the visual style of the frame (still uses your thickness/radius).' })}
                </div>
              </div>

              <div className={advancedTab === 'border' ? '' : 'hidden'}>
                {borderPreset !== 'custom' && (
                  <div className="glass p-3 mb-3">
                    <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">
                      {t('admin.obsOverlayBorderPresetControls', { defaultValue: 'Preset controls' })}
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                          {t('admin.obsOverlayBorderTintColor', { defaultValue: 'Tint color' })}
                        </label>
                        <div className="flex items-center gap-3">
                          <input
                            type="color"
                            value={borderTintColor}
                            onChange={(e) => setBorderTintColor(String(e.target.value || '').toLowerCase())}
                            className="h-10 w-14 rounded-lg border border-white/20 dark:border-white/10 bg-transparent"
                          />
                          <div className="text-xs text-gray-600 dark:text-gray-300 font-mono">{borderTintColor}</div>
                        </div>
                      </div>
                      <div className="md:col-span-2">
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                          {t('admin.obsOverlayBorderTintStrength', { defaultValue: 'Tint strength' })}:{' '}
                          <span className="font-mono">{Math.round(borderTintStrength * 100)}%</span>
                        </label>
                        <input
                          type="range"
                          min={0}
                          max={1}
                          step={0.02}
                          value={borderTintStrength}
                          onChange={(e) => setBorderTintStrength(parseFloat(e.target.value))}
                          className="w-full"
                        />
                      </div>
                    </div>
                  </div>
                )}
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                  {t('admin.obsOverlayBorder', { defaultValue: 'Border' })}: <span className="font-mono">{urlBorder}px</span>
                </label>
                <input
                  type="range"
                  min={0}
                  max={12}
                  step={1}
                  value={urlBorder}
                  onChange={(e) => setUrlBorder(parseInt(e.target.value, 10))}
                  className="w-full"
                />
              </div>

              <div className={advancedTab === 'border' ? '' : 'hidden'}>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                  {t('admin.obsOverlayBorderColor', { defaultValue: 'Border color' })}
                </label>
                <div className="flex items-center justify-between gap-3">
                  <select
                    value={borderMode}
                    onChange={(e) => setBorderMode(e.target.value as any)}
                    disabled={borderPreset !== 'custom'}
                    className="rounded-lg px-3 py-2 bg-white/60 dark:bg-white/10 text-gray-900 dark:text-white shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-50"
                    aria-label={t('admin.obsOverlayBorderMode', { defaultValue: 'Border mode' })}
                  >
                    <option value="solid">{t('admin.obsOverlayBorderModeSolid', { defaultValue: 'Solid' })}</option>
                    <option value="gradient">{t('admin.obsOverlayBorderModeGradient', { defaultValue: 'Gradient' })}</option>
                  </select>
                  <input
                    type="color"
                    value={urlBorderColor}
                    onChange={(e) => setUrlBorderColor(String(e.target.value || '').toLowerCase())}
                    disabled={borderPreset !== 'custom'}
                    className="h-10 w-14 rounded-lg border border-white/20 dark:border-white/10 bg-transparent disabled:opacity-50"
                    aria-label={t('admin.obsOverlayBorderColor', { defaultValue: 'Border color' })}
                  />
                  <div className="text-xs text-gray-600 dark:text-gray-300 font-mono">{urlBorderColor}</div>
                </div>
              </div>

              {borderPreset === 'custom' && borderMode === 'gradient' && (
                <div className={`md:col-span-2 ${advancedTab === 'border' ? '' : 'hidden'}`}>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                        {t('admin.obsOverlayBorderColor2', { defaultValue: 'Gradient color 2' })}
                      </label>
                      <input
                        type="color"
                        value={urlBorderColor2}
                        onChange={(e) => setUrlBorderColor2(String(e.target.value || '').toLowerCase())}
                        className="h-10 w-14 rounded-lg border border-white/20 dark:border-white/10 bg-transparent"
                        aria-label={t('admin.obsOverlayBorderColor2', { defaultValue: 'Gradient color 2' })}
                      />
                      <div className="text-xs text-gray-600 dark:text-gray-300 font-mono mt-1">{urlBorderColor2}</div>
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                        {t('admin.obsOverlayBorderGradientAngle', { defaultValue: 'Gradient angle' })}:{' '}
                        <span className="font-mono">{Math.round(urlBorderGradientAngle)}°</span>
                      </label>
                      <input
                        type="range"
                        min={0}
                        max={360}
                        step={1}
                        value={urlBorderGradientAngle}
                        onChange={(e) => setUrlBorderGradientAngle(parseInt(e.target.value, 10))}
                        className="w-full"
                      />
                    </div>
                  </div>
                </div>
              )}

              <div className={advancedTab === 'glass' ? '' : 'hidden'}>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                  {t('admin.obsOverlayBgOpacity', { defaultValue: 'Glass opacity' })}:{' '}
                  <span className="font-mono">{Math.round(urlBgOpacity * 100)}%</span>
                </label>
                <input
                  type="range"
                  min={0}
                  max={0.65}
                  step={0.01}
                  value={urlBgOpacity}
                  onChange={(e) => setUrlBgOpacity(parseFloat(e.target.value))}
                  disabled={!glassEnabled}
                  className="w-full disabled:opacity-50"
                />
              </div>

              {overlayShowSender && (
              <div className={`md:col-span-2 ${advancedTab === 'sender' ? '' : 'hidden'}`}>
                <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">
                  {t('admin.obsOverlaySenderTypography', { defaultValue: 'Sender label' })}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="md:col-span-3">
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                      {t('admin.obsOverlaySenderHold', { defaultValue: 'Show duration' })}:{' '}
                      <span className="font-mono">{Math.round(senderHoldMs / 100) / 10}s</span>
                    </label>
                    <input
                      type="range"
                      min={0}
                      max={8000}
                      step={100}
                      value={senderHoldMs}
                      onChange={(e) => setSenderHoldMs(parseInt(e.target.value, 10))}
                      className="w-full"
                    />
                    <div className="text-xs text-gray-600 dark:text-gray-300 mt-1">
                      {t('admin.obsOverlaySenderHoldHint', { defaultValue: '0s = stay visible the whole meme.' })}
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                      {t('admin.obsOverlaySenderFontSize', { defaultValue: 'Font size' })}:{' '}
                      <span className="font-mono">{senderFontSize}px</span>
                    </label>
                    <input
                      type="range"
                      min={10}
                      max={28}
                      step={1}
                      value={senderFontSize}
                      onChange={(e) => setSenderFontSize(parseInt(e.target.value, 10))}
                      className="w-full"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                      {t('admin.obsOverlaySenderFontWeight', { defaultValue: 'Weight' })}
                    </label>
                    <select
                      value={senderFontWeight}
                      onChange={(e) => setSenderFontWeight(parseInt(e.target.value, 10))}
                      className="w-full rounded-lg px-3 py-2 bg-white/60 dark:bg-white/10 text-gray-900 dark:text-white shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                    >
                      <option value={400}>400</option>
                      <option value={500}>500</option>
                      <option value={600}>600</option>
                      <option value={700}>700</option>
                      <option value={800}>800</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                      {t('admin.obsOverlaySenderFontFamily', { defaultValue: 'Font' })}
                    </label>
                    <select
                      value={senderFontFamily}
                      onChange={(e) => setSenderFontFamily(e.target.value as any)}
                      className="w-full rounded-lg px-3 py-2 bg-white/60 dark:bg-white/10 text-gray-900 dark:text-white shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                    >
                      <option value="system">{t('admin.obsOverlaySenderFontSystem', { defaultValue: 'System' })}</option>
                      <option value="inter">Inter</option>
                      <option value="roboto">Roboto</option>
                      <option value="montserrat">Montserrat</option>
                      <option value="poppins">Poppins</option>
                      <option value="raleway">Raleway</option>
                      <option value="nunito">Nunito</option>
                      <option value="oswald">Oswald</option>
                      <option value="playfair">Playfair Display</option>
                      <option value="jetbrains-mono">JetBrains Mono</option>
                      <option value="mono">{t('admin.obsOverlaySenderFontMono', { defaultValue: 'Monospace' })}</option>
                      <option value="serif">{t('admin.obsOverlaySenderFontSerif', { defaultValue: 'Serif' })}</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                      {t('admin.obsOverlaySenderFontColor', { defaultValue: 'Text color' })}
                    </label>
                    <div className="flex items-center gap-3">
                      <input
                        type="color"
                        value={senderFontColor}
                        onChange={(e) => setSenderFontColor(String(e.target.value || '').toLowerCase())}
                        className="h-10 w-14 rounded-lg border border-white/20 dark:border-white/10 bg-transparent"
                      />
                      <div className="text-xs text-gray-600 dark:text-gray-300 font-mono">{senderFontColor}</div>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                      {t('admin.obsOverlaySenderBgColor', { defaultValue: 'Background color' })}
                    </label>
                    <div className="flex items-center gap-3">
                      <input
                        type="color"
                        value={senderBgColor}
                        onChange={(e) => setSenderBgColor(String(e.target.value || '').toLowerCase())}
                        className="h-10 w-14 rounded-lg border border-white/20 dark:border-white/10 bg-transparent"
                      />
                      <div className="text-xs text-gray-600 dark:text-gray-300 font-mono">{senderBgColor}</div>
                    </div>
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                      {t('admin.obsOverlaySenderBgOpacity', { defaultValue: 'Background opacity' })}:{' '}
                      <span className="font-mono">{Math.round(senderBgOpacity * 100)}%</span>
                    </label>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.02}
                      value={senderBgOpacity}
                      onChange={(e) => setSenderBgOpacity(parseFloat(e.target.value))}
                      className="w-full"
                    />
                  </div>
                  <div className="md:col-span-3">
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                      {t('admin.obsOverlaySenderBgRadius', { defaultValue: 'Background radius' })}:{' '}
                      <span className="font-mono">{senderBgRadius}</span>
                    </label>
                    <div className="flex items-center gap-3">
                      <input
                        type="range"
                        min={0}
                        max={60}
                        step={1}
                        value={senderBgRadius}
                        onChange={(e) => setSenderBgRadius(parseInt(e.target.value, 10))}
                        className="w-full"
                      />
                      <button
                        type="button"
                        onClick={() => setSenderBgRadius(999)}
                        className="glass-btn px-3 py-2 text-sm font-semibold shrink-0"
                      >
                        {t('admin.obsOverlaySenderBgPill', { defaultValue: 'Pill' })}
                      </button>
                    </div>
                    <div className="text-xs text-gray-600 dark:text-gray-300 mt-1">
                      {t('admin.obsOverlaySenderBgRadiusHint', { defaultValue: 'Tip: try 8–16 for a modern rounded rectangle.' })}
                    </div>
                  </div>

                  <div className="md:col-span-3">
                    <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">
                      {t('admin.obsOverlaySenderStrokeTitle', { defaultValue: 'Label border' })}
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                          {t('admin.obsOverlaySenderStrokeStyle', { defaultValue: 'Style' })}
                        </label>
                        <select
                          value={senderStroke}
                          onChange={(e) => setSenderStroke(e.target.value as any)}
                          className="w-full rounded-lg px-3 py-2 bg-white/60 dark:bg-white/10 text-gray-900 dark:text-white shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                        >
                          <option value="glass">{t('admin.obsOverlaySenderStrokeGlass', { defaultValue: 'Glass' })}</option>
                          <option value="solid">{t('admin.obsOverlaySenderStrokeSolid', { defaultValue: 'Solid' })}</option>
                          <option value="none">{t('admin.obsOverlaySenderStrokeNone', { defaultValue: 'None' })}</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                          {t('admin.obsOverlaySenderStrokeWidth', { defaultValue: 'Width' })}:{' '}
                          <span className="font-mono">{senderStrokeWidth}px</span>
                        </label>
                        <input
                          type="range"
                          min={0}
                          max={6}
                          step={1}
                          value={senderStrokeWidth}
                          onChange={(e) => setSenderStrokeWidth(parseInt(e.target.value, 10))}
                          className="w-full"
                          disabled={senderStroke === 'none'}
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                          {t('admin.obsOverlaySenderStrokeOpacity', { defaultValue: 'Opacity' })}:{' '}
                          <span className="font-mono">{Math.round(senderStrokeOpacity * 100)}%</span>
                        </label>
                        <input
                          type="range"
                          min={0}
                          max={1}
                          step={0.02}
                          value={senderStrokeOpacity}
                          onChange={(e) => setSenderStrokeOpacity(parseFloat(e.target.value))}
                          className="w-full"
                          disabled={senderStroke === 'none'}
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                          {t('admin.obsOverlaySenderStrokeColor', { defaultValue: 'Color' })}
                        </label>
                        <div className="flex items-center gap-3">
                          <input
                            type="color"
                            value={senderStrokeColor}
                            onChange={(e) => setSenderStrokeColor(String(e.target.value || '').toLowerCase())}
                            className="h-10 w-14 rounded-lg border border-white/20 dark:border-white/10 bg-transparent"
                            disabled={senderStroke !== 'solid'}
                          />
                          <div className="text-xs text-gray-600 dark:text-gray-300 font-mono">{senderStrokeColor}</div>
                        </div>
                        <div className="text-xs text-gray-600 dark:text-gray-300 mt-1">
                          {t('admin.obsOverlaySenderStrokeHint', { defaultValue: 'Glass uses automatic highlights; Solid uses your color.' })}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              )}
            </div>
          </div>
          </div>
        </details>

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
  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const [selectedChannelId, setSelectedChannelId] = useState<string>('');
  const [adjustAmount, setAdjustAmount] = useState<string>('');
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

  const normalize = (v: string) => String(v || '').trim().toLowerCase();

  const rows = wallets as Array<{
    id: string;
    userId: string;
    channelId: string;
    balance: number;
    user: { id: string; displayName: string; twitchUserId?: string | null };
    channel: { id: string; name: string; slug: string };
  }>;

  const users = Array.from(
    new Map(
      rows.map((w) => [
        w.userId,
        { id: w.userId, displayName: w.user?.displayName || w.userId },
      ])
    ).values()
  ).sort((a, b) => a.displayName.localeCompare(b.displayName));

  const channels = Array.from(
    new Map(
      rows.map((w) => [
        w.channelId,
        { id: w.channelId, name: w.channel?.name || w.channelId, slug: w.channel?.slug || '' },
      ])
    ).values()
  ).sort((a, b) => a.name.localeCompare(b.name));

  const selectedUser = users.find((u) => u.id === selectedUserId) || null;
  const selectedChannel = channels.find((c) => c.id === selectedChannelId) || null;

  const isSelfUnlimitedPair = (w: { user: { displayName: string }; channel: { name: string; slug: string } }) => {
    const u = normalize(w.user?.displayName);
    const cName = normalize(w.channel?.name);
    const cSlug = normalize(w.channel?.slug);
    return !!u && (u === cName || u === cSlug);
  };

  const candidatePairsForUser = selectedUserId
    ? rows
        .filter((w) => w.userId === selectedUserId)
        .filter((w) => !isSelfUnlimitedPair(w))
        .sort((a, b) => (a.channel?.name || '').localeCompare(b.channel?.name || ''))
    : [];

  // Keep selection sane when data changes.
  useEffect(() => {
    if (!selectedUserId && users.length > 0) {
      setSelectedUserId(users[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [users.length]);

  useEffect(() => {
    if (!selectedUserId) return;
    const stillValid = candidatePairsForUser.some((p) => p.channelId === selectedChannelId);
    if (!stillValid) {
      setSelectedChannelId(candidatePairsForUser[0]?.channelId || '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedUserId, wallets.length]);

  const selectedPair =
    selectedUserId && selectedChannelId
      ? rows.find((w) => w.userId === selectedUserId && w.channelId === selectedChannelId) || null
      : null;

  const handleAdjust = async (userId: string, channelId: string) => {
    const raw = adjustAmount.trim();
    const amount = parseInt(raw, 10);
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
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">
              {t('admin.user')}
            </div>
            <select
              value={selectedUserId}
              onChange={(e) => {
                setSelectedUserId(e.target.value);
                setAdjustAmount('');
              }}
              className="w-full rounded-xl px-3 py-2 bg-gray-50 dark:bg-gray-900/40 text-gray-900 dark:text-white shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.displayName}
                </option>
              ))}
            </select>
          </div>

          <div>
            <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">
              {t('admin.channel') || 'Channel'}
            </div>
            <select
              value={selectedChannelId}
              onChange={(e) => {
                setSelectedChannelId(e.target.value);
                setAdjustAmount('');
              }}
              className="w-full rounded-xl px-3 py-2 bg-gray-50 dark:bg-gray-900/40 text-gray-900 dark:text-white shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              disabled={!selectedUserId || candidatePairsForUser.length === 0}
            >
              {candidatePairsForUser.length === 0 ? (
                <option value="">
                  {selectedUserId
                    ? t('admin.noWallets', { defaultValue: 'No wallets found' })
                    : t('admin.loadingWallets', { defaultValue: 'Loading wallets...' })}
                </option>
              ) : (
                candidatePairsForUser.map((p) => (
                  <option key={p.channelId} value={p.channelId}>
                    {p.channel?.name || p.channelId}
                  </option>
                ))
              )}
            </select>
          </div>
        </div>

        <div className="mt-4 glass p-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="text-sm text-gray-800 dark:text-gray-100">
              <div className="font-semibold">
                {(selectedUser?.displayName || '') && (selectedChannel?.name || '')
                  ? `${selectedUser?.displayName} → ${selectedChannel?.name}`
                  : t('admin.walletManagement')}
              </div>
              <div className="text-xs text-gray-600 dark:text-gray-300 mt-0.5">
                {selectedPair
                  ? `${t('admin.balance') || 'Balance'}: ${selectedPair.balance} coins`
                  : t('admin.noWallets', { defaultValue: 'No wallets found' })}
              </div>
              {(selectedUser && selectedChannel) && (
                <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">
                  {t('admin.walletHint', { defaultValue: 'Tip: choose a viewer and a streamer channel — streamer self-wallets are hidden (unlimited).' })}
                </div>
              )}
            </div>

            <div className="flex gap-2 items-center">
              <input
                inputMode="numeric"
                pattern="^-?\\d*$"
                value={adjustAmount}
                onChange={(e) => {
                  // Allow typing '-' and digits; prevent browser stepping behavior and keep UX stable.
                  const v = e.target.value;
                  if (/^-?\d*$/.test(v)) setAdjustAmount(v);
                }}
                placeholder={t('admin.amount')}
                className="w-28 rounded-xl px-3 py-2 text-sm bg-gray-50 dark:bg-gray-900/40 text-gray-900 dark:text-white shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                disabled={!selectedPair || adjusting !== null}
              />
              <button
                onClick={() => selectedPair && handleAdjust(selectedPair.userId, selectedPair.channelId)}
                disabled={!selectedPair || adjusting !== null}
                className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white px-4 py-2 rounded-xl text-sm"
              >
                {adjusting ? t('admin.adjusting') : t('admin.adjust')}
              </button>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-3 gap-2">
            <button
              type="button"
              className="rounded-xl bg-white/60 dark:bg-white/10 hover:bg-white/80 dark:hover:bg-white/15 px-3 py-2 text-xs text-gray-800 dark:text-gray-100"
              disabled={!selectedPair || adjusting !== null}
              onClick={() => setAdjustAmount((p) => String((parseInt(p || '0', 10) || 0) + 100))}
            >
              +100
            </button>
            <button
              type="button"
              className="rounded-xl bg-white/60 dark:bg-white/10 hover:bg-white/80 dark:hover:bg-white/15 px-3 py-2 text-xs text-gray-800 dark:text-gray-100"
              disabled={!selectedPair || adjusting !== null}
              onClick={() => setAdjustAmount((p) => String((parseInt(p || '0', 10) || 0) + 1000))}
            >
              +1000
            </button>
            <button
              type="button"
              className="rounded-xl bg-white/60 dark:bg-white/10 hover:bg-white/80 dark:hover:bg-white/15 px-3 py-2 text-xs text-gray-800 dark:text-gray-100"
              disabled={!selectedPair || adjusting !== null}
              onClick={() => setAdjustAmount('')}
            >
              {t('common.clear', { defaultValue: 'Clear' })}
            </button>
          </div>
        </div>

        <details className="mt-4">
          <summary className="cursor-pointer text-sm text-gray-700 dark:text-gray-200">
            {t('admin.allWallets', { defaultValue: 'All wallets (advanced)' })}
          </summary>
          <div className="overflow-x-auto mt-3">
            <table className="w-full">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  <th className="p-2">{t('admin.user')}</th>
                  <th className="p-2">{t('admin.channel') || 'Channel'}</th>
                  <th className="p-2">{t('admin.balance') || 'Balance'}</th>
                </tr>
              </thead>
              <tbody>
                {rows
                  .filter((w) => !isSelfUnlimitedPair(w))
                  .map((w) => (
                    <tr key={w.id} className="border-t border-gray-200/70 dark:border-white/10">
                      <td className="p-2 dark:text-gray-100">{w.user.displayName}</td>
                      <td className="p-2 dark:text-gray-100">{w.channel.name}</td>
                      <td className="p-2 font-bold dark:text-white">{w.balance} coins</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </details>
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
  const [twitchRewardEligible, setTwitchRewardEligible] = useState<boolean | null>(null);
  const [eligibilityLoading, setEligibilityLoading] = useState(false);
  const [lastErrorRequestId, setLastErrorRequestId] = useState<string | null>(null);
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
  const [twitchSavedPulse, setTwitchSavedPulse] = useState(false);
  const [approvedSavedPulse, setApprovedSavedPulse] = useState(false);
  const lastApprovedNonZeroRef = useRef<number>(100);
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

  // Track last non-zero value for the approved meme reward toggle.
  useEffect(() => {
    const coins = rewardSettings.submissionRewardCoins ? parseInt(rewardSettings.submissionRewardCoins, 10) : 0;
    if (Number.isFinite(coins) && coins > 0) {
      lastApprovedNonZeroRef.current = coins;
    }
  }, [rewardSettings.submissionRewardCoins]);

  // Check Twitch reward eligibility (affiliate/partner) to hide/disable reward UI.
  useEffect(() => {
    if (!user?.channelId) return;
    let cancelled = false;
    (async () => {
      try {
        setEligibilityLoading(true);
        const { api } = await import('../lib/api');
        const res = await api.get<{ eligible: boolean | null; broadcasterType?: string | null; checkedBroadcasterId?: string; reason?: string }>(
          '/admin/twitch/reward/eligibility',
          { timeout: 15000 }
        );
        if (cancelled) return;
        // eligible can be null ("unknown") on beta when Twitch doesn't return channel info.
        setTwitchRewardEligible(res?.eligible === null ? null : !!res?.eligible);
        setLastErrorRequestId(null);
      } catch {
        if (!cancelled) setTwitchRewardEligible(null);
      } finally {
        if (!cancelled) setEligibilityLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.channelId]);

  const handleSaveTwitchReward = async () => {
    const startedAt = Date.now();
    setSavingTwitchReward(true);
    try {
      const { api } = await import('../lib/api');
      // Ensure reward title is never empty when enabling (prevents 400s and creates a good default UX).
      const effectiveTitle =
        rewardSettings.rewardEnabled && !rewardSettings.rewardTitle.trim()
          ? t('admin.rewardTitlePlaceholder', { defaultValue: 'Get Coins' })
          : rewardSettings.rewardTitle;

      // Ensure reward cost/coins are never empty when enabling (prevents 400s; default 1000/1000).
      const effectiveCostStr =
        rewardSettings.rewardEnabled && !String(rewardSettings.rewardCost || '').trim() ? '1000' : rewardSettings.rewardCost;
      const effectiveCoinsStr =
        rewardSettings.rewardEnabled && !String(rewardSettings.rewardCoins || '').trim() ? '1000' : rewardSettings.rewardCoins;

      if (
        effectiveTitle !== rewardSettings.rewardTitle ||
        effectiveCostStr !== rewardSettings.rewardCost ||
        effectiveCoinsStr !== rewardSettings.rewardCoins
      ) {
        setRewardSettings((p) => ({
          ...p,
          rewardTitle: effectiveTitle,
          rewardCost: effectiveCostStr,
          rewardCoins: effectiveCoinsStr,
        }));
      }
      await api.patch('/admin/channel/settings', {
        // Twitch reward only (do NOT include submissionRewardCoins here)
        rewardIdForCoins: rewardSettings.rewardIdForCoins || null,
        rewardEnabled: rewardSettings.rewardEnabled,
        rewardTitle: effectiveTitle || null,
        rewardCost: effectiveCostStr ? parseInt(effectiveCostStr, 10) : null,
        rewardCoins: effectiveCoinsStr ? parseInt(effectiveCoinsStr, 10) : null,
      });
      lastSavedTwitchRef.current = JSON.stringify({
        rewardIdForCoins: rewardSettings.rewardIdForCoins || null,
        rewardEnabled: rewardSettings.rewardEnabled,
        rewardTitle: effectiveTitle || null,
        rewardCost: effectiveCostStr ? parseInt(effectiveCostStr, 10) : null,
        rewardCoins: effectiveCoinsStr ? parseInt(effectiveCoinsStr, 10) : null,
      });
      setLastErrorRequestId(null);
    } catch (error: unknown) {
      const apiError = error as { response?: { status?: number; data?: { error?: string; errorCode?: string } } };
      const code = apiError.response?.data?.errorCode;
      const raw = apiError.response?.data?.error || '';
      const { getRequestIdFromError } = await import('../lib/api');
      const rid = getRequestIdFromError(error);
      setLastErrorRequestId(rid);

      if (code === 'TWITCH_REWARD_NOT_AVAILABLE' || raw.includes("doesn't have partner") || raw.includes('affiliate')) {
        toast.error(t('admin.twitchRewardNotAvailable', { defaultValue: 'This Twitch reward is available only for affiliate/partner channels.' }));
        // Ensure UI doesn't stay enabled after a failed enable attempt.
        setRewardSettings((p) => ({ ...p, rewardEnabled: false }));
      } else if (code === 'REWARD_COST_COINS_REQUIRED' || raw.includes('Reward cost and coins are required')) {
        toast.error(t('admin.rewardCostCoinsRequired', { defaultValue: 'Reward cost and coins are required.' }));
      } else {
        const errorMessage = raw || t('admin.failedToSaveSettings') || 'Failed to save settings';
        toast.error(errorMessage);
      }

      if (apiError.response?.data && typeof apiError.response.data === 'object' && 'requiresReauth' in apiError.response.data) {
        setTimeout(() => {
          if (window.confirm(t('admin.requiresReauth') || 'You need to log out and log in again to enable Twitch rewards. Log out now?')) {
            window.location.href = '/';
          }
        }, 2000);
      }
    } finally {
      await ensureMinDuration(startedAt, 1000);
      setSavingTwitchReward(false);
      setTwitchSavedPulse(true);
      window.setTimeout(() => setTwitchSavedPulse(false), 700);
    }
  };

  const handleSaveApprovedMemeReward = async () => {
    const startedAt = Date.now();
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
      await ensureMinDuration(startedAt, 1000);
      setSavingApprovedMemeReward(false);
      setApprovedSavedPulse(true);
      window.setTimeout(() => setApprovedSavedPulse(false), 700);
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
        <div className="glass p-6 relative">
          {savingTwitchReward && <SavingOverlay label={t('admin.saving', { defaultValue: 'Saving…' })} />}
          {twitchSavedPulse && !savingTwitchReward && <SavedOverlay label={t('admin.saved', { defaultValue: 'Saved' })} />}
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-lg font-semibold dark:text-white mb-1">
                {t('admin.twitchCoinsRewardTitle', 'Награда за монеты (Twitch)')}
              </h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {t('admin.twitchCoinsRewardDescription', 'Зритель тратит Channel Points на Twitch и получает монеты на сайте.')}
              </p>
              {twitchRewardEligible === null && (
                <p className="mt-2 text-sm text-yellow-700 dark:text-yellow-300">
                  {t('admin.twitchEligibilityUnknown', {
                    defaultValue:
                      "We couldn't verify Twitch eligibility right now. You can try enabling the reward; if it fails, log out and log in again.",
                  })}
                </p>
              )}
              {lastErrorRequestId && (
                <p className="mt-2 text-xs text-gray-600 dark:text-gray-400 select-text">
                  {t('common.errorId', { defaultValue: 'Error ID' })}: <span className="font-mono">{lastErrorRequestId}</span>
                </p>
              )}
              {twitchRewardEligible === false && (
                <p className="mt-2 text-sm text-yellow-700 dark:text-yellow-300">
                  {t('admin.twitchRewardNotAvailable', { defaultValue: 'This Twitch reward is available only for affiliate/partner channels.' })}
                </p>
              )}
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={rewardSettings.rewardEnabled}
                disabled={savingTwitchReward || eligibilityLoading || twitchRewardEligible === false}
                onChange={(e) => {
                  if (twitchRewardEligible === false) {
                    toast.error(t('admin.twitchRewardNotAvailable', { defaultValue: 'This Twitch reward is available only for affiliate/partner channels.' }));
                    return;
                  }
                  const nextEnabled = e.target.checked;
                  // Friendly defaults when enabling.
                  if (nextEnabled) {
                    setRewardSettings((p) => ({
                      ...p,
                      rewardEnabled: true,
                      rewardTitle: p.rewardTitle?.trim()
                        ? p.rewardTitle
                        : t('admin.rewardTitlePlaceholder', { defaultValue: 'Get Coins' }),
                      rewardCost: String(p.rewardCost || '').trim() ? p.rewardCost : '1000',
                      rewardCoins: String(p.rewardCoins || '').trim() ? p.rewardCoins : '1000',
                    }));
                    return;
                  }
                  setRewardSettings((p) => ({ ...p, rewardEnabled: false }));
                }}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/20 dark:peer-focus:ring-primary/30 rounded-full peer dark:bg-gray-600 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-primary"></div>
            </label>
          </div>

          {rewardSettings.rewardEnabled && (
            <div className={`space-y-4 mt-4 ${savingTwitchReward ? 'pointer-events-none opacity-60' : ''}`}>
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

          {/* Removed persistent Saved label; we show overlays instead to avoid noise. */}
        </div>

        {/* Card B: Approved meme reward (coins) */}
        <div className="glass p-6 relative">
          {savingApprovedMemeReward && <SavingOverlay label={t('admin.saving', { defaultValue: 'Saving…' })} />}
          {approvedSavedPulse && !savingApprovedMemeReward && <SavedOverlay label={t('admin.saved', { defaultValue: 'Saved' })} />}
          <div className="flex items-start justify-between gap-4 mb-4">
            <div className="min-w-0">
              <h3 className="text-lg font-semibold dark:text-white mb-1">
                {t('admin.approvedMemeRewardTitle', 'Награда за одобренный мем (монеты)')}
              </h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {t('admin.approvedMemeRewardDescription', 'Начисляется автору заявки после одобрения.')}
              </p>
            </div>

            <label className={`relative inline-flex items-center cursor-pointer shrink-0 ${savingApprovedMemeReward ? 'opacity-60 cursor-not-allowed' : ''}`}>
              <input
                type="checkbox"
                checked={(parseInt(rewardSettings.submissionRewardCoins || '0', 10) || 0) > 0}
                disabled={savingApprovedMemeReward}
                onChange={(e) => {
                  if (savingApprovedMemeReward) return;
                  const enabled = e.target.checked;
                  if (!enabled) {
                    setRewardSettings({ ...rewardSettings, submissionRewardCoins: '0' });
                    return;
                  }
                  const restore = lastApprovedNonZeroRef.current > 0 ? lastApprovedNonZeroRef.current : 100;
                  setRewardSettings({ ...rewardSettings, submissionRewardCoins: String(restore) });
                }}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/20 dark:peer-focus:ring-primary/30 rounded-full peer dark:bg-gray-600 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-primary"></div>
            </label>
          </div>

          <div className={savingApprovedMemeReward ? 'pointer-events-none opacity-60' : ''}>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {t('admin.submissionRewardCoins', { defaultValue: 'Reward for approved submission (coins)' })}
            </label>
            <div className="flex items-center gap-2">
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
              <button
                type="button"
                className="shrink-0 rounded-lg px-3 py-2 text-sm font-semibold glass-btn bg-white/40 dark:bg-white/5 text-gray-900 dark:text-white hover:bg-white/60 dark:hover:bg-white/10 transition-colors"
                onClick={() => {
                  const current = rewardSettings.submissionRewardCoins ? parseInt(rewardSettings.submissionRewardCoins, 10) : 0;
                  const next = (Number.isFinite(current) ? current : 0) + 100;
                  setRewardSettings({ ...rewardSettings, submissionRewardCoins: String(next) });
                }}
                disabled={savingApprovedMemeReward}
              >
                {t('admin.quickAdd100', { defaultValue: '+100' })}
              </button>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              {t('admin.submissionRewardCoinsDescription', { defaultValue: 'Coins granted to the viewer when you approve their submission. Set 0 to disable.' })}
            </p>
          </div>

          {/* Removed persistent Saved label; we show overlays instead to avoid noise. */}
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
  const [savedPulse, setSavedPulse] = useState(false);
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
        const startedAt = Date.now();
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
          await ensureMinDuration(startedAt, 1000);
          setLoading(false);
          setSavedPulse(true);
          window.setTimeout(() => setSavedPulse(false), 700);
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
    <div className="surface p-6 relative">
      {loading && <SavingOverlay label={t('admin.saving', { defaultValue: 'Saving…' })} />}
      {savedPulse && !loading && <SavedOverlay label={t('admin.saved', { defaultValue: 'Saved' })} />}
      <h2 className="text-2xl font-bold mb-4 dark:text-white">{t('admin.channelDesign', 'Оформление')}</h2>

      {/* Preferences */}
      <div className={`mb-6 pb-6 ${loading ? 'pointer-events-none opacity-60' : ''}`}>
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

      <div className={`space-y-4 ${loading ? 'pointer-events-none opacity-60' : ''}`}>
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

        {/* Removed persistent Saved label; we show overlays instead to avoid noise. */}
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
