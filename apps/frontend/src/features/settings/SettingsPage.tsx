import { useEffect, useState, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAppSelector, useAppDispatch } from '@/store/hooks';
import { store } from '@/store/index';
import { fetchSubmissions, approveSubmission, rejectSubmission } from '@/store/slices/submissionsSlice';
import Header from '@/components/Header';
import VideoPreview from '@/components/VideoPreview';
import toast from 'react-hot-toast';
import { BetaAccessSelf } from '@/features/settings/tabs/BetaAccessSelf';
import { BetaAccessManagement } from '@/features/settings/tabs/BetaAccessManagement';
import { PromotionManagement } from '@/features/settings/tabs/PromotionManagement';
import { ChannelStatistics } from '@/features/settings/tabs/ChannelStatistics';
import { WalletManagement } from '@/features/settings/tabs/WalletManagement';
import { RewardsSettings } from '@/features/settings/tabs/RewardsSettings';
import { ChannelSettings } from '@/features/settings/tabs/ChannelSettings';
import { ObsLinksSettings } from '@/features/settings/tabs/ObsLinksSettings';

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
      // Perf: avoid immediate refetch; slice updates remove the submission locally and adjust total.
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
      // Perf: avoid immediate refetch; slice updates remove the submission locally and adjust total.
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
                    {t('admin.channelDesign', 'РћС„РѕСЂРјР»РµРЅРёРµ')}
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
                    {t('admin.rewards', 'РќР°РіСЂР°РґС‹')}
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

              {/* Dropdown РјРµРЅСЋ */}
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
                               By {submission.submitter.displayName} вЂў {submission.type}
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


// ObsLinksSettings moved to src/features/settings/tabs/ObsLinksSettings.tsx

// Tabs moved into src/features/settings/tabs/* for faster navigation and search.

