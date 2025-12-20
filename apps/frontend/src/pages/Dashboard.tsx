import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAppSelector, useAppDispatch } from '../store/hooks';
import { store } from '../store/index';
import { fetchSubmissions, approveSubmission, rejectSubmission } from '../store/slices/submissionsSlice';
import { fetchMemes } from '../store/slices/memesSlice';
import Header from '../components/Header';
import SubmitModal from '../components/SubmitModal';
import MemeCard from '../components/MemeCard';
import MemeModal from '../components/MemeModal';
import toast from 'react-hot-toast';
import { useSearchParams } from 'react-router-dom';
import type { Meme } from '../types';
import { useAutoplayMemes } from '../hooks/useAutoplayMemes';
import { PendingSubmissionsPanel } from '../components/dashboard/PendingSubmissionsPanel';
import { AllMemesPanel } from '../components/dashboard/AllMemesPanel';

export default function Dashboard() {
  const { t } = useTranslation();
  const { user, loading: authLoading } = useAppSelector((state) => state.auth);
  const { submissions, loading: submissionsLoading } = useAppSelector((state) => state.submissions);
  const { memes, loading: memesLoading } = useAppSelector((state) => state.memes);
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [isSubmitModalOpen, setIsSubmitModalOpen] = useState(false);
  const submissionsLoadedRef = useRef(false);
  const memesLoadedRef = useRef(false);
  const [approveModal, setApproveModal] = useState<{ open: boolean; submissionId: string | null }>({
    open: false,
    submissionId: null,
  });
  const [rejectModal, setRejectModal] = useState<{ open: boolean; submissionId: string | null }>({
    open: false,
    submissionId: null,
  });
  const [priceCoins, setPriceCoins] = useState('100');
  const [rejectReason, setRejectReason] = useState('');
  const [selectedMeme, setSelectedMeme] = useState<Meme | null>(null);
  const [isMemeModalOpen, setIsMemeModalOpen] = useState(false);
  const { autoplayMemesEnabled } = useAutoplayMemes();

  const panel = (searchParams.get('panel') || '').toLowerCase();
  const isPanelOpen = panel === 'submissions' || panel === 'memes';

  const setPanel = (next: 'submissions' | 'memes' | null, replace = false) => {
    const nextParams = new URLSearchParams(searchParams);
    // Back-compat: remove older tab param
    nextParams.delete('tab');
    if (next) nextParams.set('panel', next);
    else nextParams.delete('panel');
    setSearchParams(nextParams, { replace });
  };

  useEffect(() => {
    if (!authLoading && !user) {
      console.log('[Dashboard] No user, redirecting to /', { authLoading, user });
      navigate('/');
    }
  }, [user, authLoading, navigate]);

  // Removed role restrictions - Dashboard is accessible to all users

  // Back-compat: if someone navigates to /dashboard?tab=submissions, open the submissions panel.
  useEffect(() => {
    const tab = (searchParams.get('tab') || '').toLowerCase();
    if (tab === 'submissions') {
      setPanel('submissions', true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load pending submissions if user is streamer/admin
  // Check Redux store with TTL to avoid duplicate requests on navigation
  useEffect(() => {
    const userId = user?.id;
    const userRole = user?.role;
    const userChannelId = user?.channelId;

    if (userId && (userRole === 'streamer' || userRole === 'admin') && userChannelId) {
      const currentState = store.getState();
      const submissionsState = currentState.submissions;
      const SUBMISSIONS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
      const ERROR_RETRY_DELAY = 5 * 60 * 1000; // 5 minutes before retrying after error
      
      // Check if we have fresh data based on timestamp
      const hasFreshData = submissionsState.submissions.length > 0 && 
        submissionsState.lastFetchedAt !== null &&
        (Date.now() - submissionsState.lastFetchedAt) < SUBMISSIONS_CACHE_TTL;
      
      // Check if we had a recent error (especially 403) - don't retry immediately
      const hasRecentError = submissionsState.lastErrorAt !== null &&
        (Date.now() - submissionsState.lastErrorAt) < ERROR_RETRY_DELAY;
      
      const isLoading = submissionsState.loading;
      
      // Only fetch if no fresh data, not loading, no recent error, and not already loaded
      if (!hasFreshData && !isLoading && !hasRecentError && !submissionsLoadedRef.current) {
        submissionsLoadedRef.current = true;
        dispatch(fetchSubmissions({ status: 'pending' }));
      } else if (hasFreshData) {
        submissionsLoadedRef.current = true; // Mark as loaded even if we didn't fetch
      }
    }
    // Reset ref when user changes
    if (!userId || !userChannelId) {
      submissionsLoadedRef.current = false;
    }
  }, [user?.id, user?.role, user?.channelId, dispatch]); // Use user?.id instead of user to prevent unnecessary re-runs

  // Load memes for own channel (needed for dashboard "All memes" panel)
  useEffect(() => {
    const userId = user?.id;
    const userRole = user?.role;
    const userChannelId = user?.channelId;
    if (!userId || !userChannelId || !(userRole === 'streamer' || userRole === 'admin')) {
      memesLoadedRef.current = false;
      return;
    }

    // If already loaded for this channel (or currently loading), skip.
    if (memesLoading) return;
    if (memesLoadedRef.current) return;

    // If memes for this channel exist in store, consider it loaded.
    const channelMemes = memes.filter((m) => m.channelId === userChannelId);
    if (channelMemes.length > 0) {
      memesLoadedRef.current = true;
      return;
    }

    memesLoadedRef.current = true;
    dispatch(fetchMemes({ channelId: userChannelId }));
  }, [user?.id, user?.role, user?.channelId, memesLoading, memes, dispatch]);

  const pendingSubmissionsCount = submissions.filter(s => s.status === 'pending').length;

  const myChannelMemes = useMemo(() => {
    if (!user?.channelId) return [];
    return memes.filter((m) => m.channelId === user.channelId);
  }, [memes, user?.channelId]);

  if (authLoading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-xl">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900">
      <Header />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <h1 className="text-3xl font-bold mb-2 dark:text-white">{t('dashboard.title', 'Dashboard')}</h1>
        <p className="text-gray-600 dark:text-gray-400 mb-8">
          {t('dashboard.subtitle', 'Manage your memes and channel settings')}
        </p>
        
        {user.channelId ? (
          <>
            {/* Wallet Balance - Prominent Display */}
            {user.wallets && user.wallets.length > 0 && (
              <div className="mb-8">
                <div className="bg-gradient-to-r from-purple-600 to-indigo-600 rounded-xl shadow-lg p-6 text-white">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-purple-100 text-sm mb-1">{t('dashboard.yourBalance', 'Your Balance')}</p>
                      <div className="text-4xl font-bold">
                        {user.wallets.find(w => w.channelId === user.channelId)?.balance || 0} 
                        <span className="text-2xl text-purple-200"> coins</span>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-purple-100 text-sm">
                        {t('dashboard.redeemChannelPoints', 'Redeem channel points on Twitch to earn more!')}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Quick Actions Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6 mb-6">
              {/* Submit Meme Card - Primary */}
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 hover:shadow-2xl transition-shadow border-2 border-primary/20">
                <h2 className="text-2xl font-bold mb-4 dark:text-white">{t('dashboard.quickActions.submitMeme', 'Submit Meme')}</h2>
                <p className="text-gray-600 dark:text-gray-400 text-sm mb-4">
                  {t('dashboard.quickActions.submitMemeDescription', 'Add a meme directly to your pool')}
                </p>
                <button
                  onClick={() => setIsSubmitModalOpen(true)}
                  className="w-full bg-primary hover:bg-secondary text-white font-bold py-4 px-6 rounded-lg transition-colors text-lg shadow-lg"
                >
                  {t('dashboard.quickActions.submitMemeButton', 'Submit Meme')}
                </button>
              </div>

              {/* Pending Submissions Card - Secondary */}
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 hover:shadow-lg transition-shadow border border-secondary/20">
                <div className="flex items-center justify-between mb-2">
                  <h2 className="text-xl font-semibold dark:text-white">{t('dashboard.quickActions.pendingSubmissions', 'Pending Submissions')}</h2>
                  {pendingSubmissionsCount > 0 && (
                    <span className="bg-red-500 text-white text-sm font-bold rounded-full px-3 py-1">
                      {pendingSubmissionsCount}
                    </span>
                  )}
                </div>
                <p className="text-gray-600 dark:text-gray-400 text-sm mb-4">
                  {t('dashboard.quickActions.pendingSubmissionsDescription', 'Review and approve meme submissions')}
                </p>
                <button
                  onClick={() => setPanel(panel === 'submissions' ? null : 'submissions')}
                  className={`w-full font-semibold py-3 px-6 rounded-lg transition-colors ${
                    panel === 'submissions'
                      ? 'bg-red-600 hover:bg-red-700 text-white'
                      : pendingSubmissionsCount > 0
                        ? 'bg-red-500 hover:bg-red-600 text-white'
                        : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-gray-600'
                  }`}
                >
                  {pendingSubmissionsCount > 0 
                    ? t('dashboard.quickActions.pendingSubmissionsButton', `${pendingSubmissionsCount} Pending`, { count: pendingSubmissionsCount })
                    : t('dashboard.quickActions.noPendingSubmissions', 'No Pending')
                  }
                </button>
              </div>

              {/* All Memes Card */}
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 hover:shadow-md transition-shadow border border-secondary/20">
                <div className="flex items-center justify-between mb-2">
                  <h2 className="text-lg font-medium dark:text-white">
                    {t('dashboard.quickActions.allMemes', { defaultValue: 'All memes' })}
                  </h2>
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    {memesLoading ? '…' : myChannelMemes.length}
                  </span>
                </div>
                <p className="text-gray-600 dark:text-gray-400 text-sm mb-4">
                  {t('dashboard.quickActions.allMemesDescription', { defaultValue: 'Browse and edit your meme library' })}
                </p>
                <button
                  onClick={() => setPanel(panel === 'memes' ? null : 'memes')}
                  className={`w-full font-semibold py-3 px-6 rounded-lg transition-colors ${
                    panel === 'memes'
                      ? 'bg-primary hover:bg-secondary text-white'
                      : 'bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200'
                  }`}
                >
                  {panel === 'memes'
                    ? t('common.close', { defaultValue: 'Close' })
                    : t('dashboard.quickActions.openAllMemes', { defaultValue: 'Open' })}
                </button>
              </div>

              {/* Settings Card - Tertiary */}
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 hover:shadow-md transition-shadow opacity-90">
                <h2 className="text-lg font-medium mb-4 dark:text-white">{t('dashboard.quickActions.settings', 'Settings')}</h2>
                <p className="text-gray-600 dark:text-gray-400 text-sm mb-4">
                  {t('dashboard.quickActions.settingsDescription', 'Configure your channel and preferences')}
                </p>
                <button
                  onClick={() => navigate('/settings?tab=settings')}
                  className="w-full bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200 font-medium py-3 px-6 rounded-lg transition-colors"
                >
                  {t('dashboard.quickActions.settingsButton', 'Open Settings')}
                </button>
              </div>
            </div>

            {/* Expandable panels */}
            <div className={`transition-all duration-300 ${isPanelOpen ? 'mb-8' : 'mb-2'}`}>
              <div
                className={`overflow-hidden transition-all duration-300 ${
                  panel === 'submissions' || panel === 'memes' ? 'max-h-[4000px] opacity-100' : 'max-h-0 opacity-0'
                }`}
              >
                <PendingSubmissionsPanel
                  isOpen={panel === 'submissions'}
                  submissions={submissions}
                  submissionsLoading={submissionsLoading}
                  pendingCount={pendingSubmissionsCount}
                  onClose={() => setPanel(null)}
                  onApprove={(submissionId) => {
                    setApproveModal({ open: true, submissionId });
                    setPriceCoins('100');
                  }}
                  onReject={(submissionId) => {
                    setRejectModal({ open: true, submissionId });
                    setRejectReason('');
                  }}
                />

                <AllMemesPanel
                  isOpen={panel === 'memes'}
                  memes={myChannelMemes}
                  memesLoading={memesLoading}
                  autoplayPreview={autoplayMemesEnabled ? 'autoplayMuted' : 'hoverWithSound'}
                  onClose={() => setPanel(null)}
                  onSelectMeme={(meme) => {
                    setSelectedMeme(meme);
                    setIsMemeModalOpen(true);
                  }}
                />
              </div>
            </div>

            {/* Additional Actions */}
            <div className="mb-6 flex flex-wrap gap-4">
              <button
                onClick={() => {
                  if (user.channel?.slug) {
                    navigate(`/channel/${user.channel.slug}`);
                  }
                }}
                className="bg-primary hover:bg-secondary text-white font-semibold py-2 px-6 rounded-lg transition-colors"
              >
                {t('dashboard.viewPublicProfile')}
              </button>
            </div>
          </>
        ) : (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6">
            <p className="text-gray-600 dark:text-gray-400">
              {t('dashboard.noChannel', 'You don\'t have a channel yet. Create one to start using the platform.')}
            </p>
          </div>
        )}
      </main>

      {/* Submit Modal */}
      {user.channelId && (
        <SubmitModal
          isOpen={isSubmitModalOpen}
          onClose={() => setIsSubmitModalOpen(false)}
          channelSlug={user.channel?.slug}
          channelId={user.channelId}
        />
      )}

      {/* Meme Modal */}
      {isMemeModalOpen && (
        <MemeModal
          meme={selectedMeme}
          isOpen={isMemeModalOpen}
          onClose={() => {
            setIsMemeModalOpen(false);
            setSelectedMeme(null);
          }}
          onUpdate={() => {
            if (user?.channelId) {
              dispatch(fetchMemes({ channelId: user.channelId }));
            }
          }}
          isOwner={true}
          mode="admin"
        />
      )}

      {/* Approve Modal (Dashboard) */}
      {approveModal.open && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="fixed inset-0 bg-black/50 transition-opacity" onClick={() => setApproveModal({ open: false, submissionId: null })} />
          <div className="flex min-h-full items-center justify-center p-4">
            <div className="relative bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full">
              <div className="sticky top-0 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-4 flex justify-between items-center">
                <h2 className="text-2xl font-bold dark:text-white">{t('admin.approveSubmission', { defaultValue: 'Approve submission' })}</h2>
                <button
                  onClick={() => setApproveModal({ open: false, submissionId: null })}
                  className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                  aria-label={t('common.close', { defaultValue: 'Close' })}
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
                    value={priceCoins}
                    onChange={(e) => setPriceCoins(e.target.value)}
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
                    onClick={() => setApproveModal({ open: false, submissionId: null })}
                    className="flex-1 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200 font-semibold py-2 px-4 rounded-lg transition-colors"
                  >
                    {t('common.cancel', { defaultValue: 'Cancel' })}
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      if (!approveModal.submissionId) return;
                      const parsed = parseInt(priceCoins, 10);
                      if (Number.isNaN(parsed) || parsed < 1) {
                        toast.error(t('admin.invalidPrice', { defaultValue: 'Price must be at least 1 coin' }));
                        return;
                      }
                      try {
                        await dispatch(approveSubmission({ submissionId: approveModal.submissionId, priceCoins: parsed })).unwrap();
                        toast.success(t('admin.approve', { defaultValue: 'Approve' }));
                        setApproveModal({ open: false, submissionId: null });
                        dispatch(fetchSubmissions({ status: 'pending' }));
                      } catch {
                        toast.error(t('admin.failedToApprove', { defaultValue: 'Failed to approve submission' }));
                      }
                    }}
                    className="flex-1 bg-green-600 hover:bg-green-700 text-white font-semibold py-2 px-4 rounded-lg transition-colors"
                  >
                    {t('admin.approve', { defaultValue: 'Approve' })}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Reject Modal (Dashboard) */}
      {rejectModal.open && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="fixed inset-0 bg-black/50 transition-opacity" onClick={() => setRejectModal({ open: false, submissionId: null })} />
          <div className="flex min-h-full items-center justify-center p-4">
            <div className="relative bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full">
              <div className="sticky top-0 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-4 flex justify-between items-center">
                <h2 className="text-2xl font-bold dark:text-white">{t('admin.rejectSubmission', { defaultValue: 'Reject submission' })}</h2>
                <button
                  onClick={() => setRejectModal({ open: false, submissionId: null })}
                  className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                  aria-label={t('common.close', { defaultValue: 'Close' })}
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
                    {t('admin.rejectionReason', { defaultValue: 'Reason for rejection' })} <span className="text-red-500">*</span>
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
                    onClick={() => setRejectModal({ open: false, submissionId: null })}
                    className="flex-1 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200 font-semibold py-2 px-4 rounded-lg transition-colors"
                  >
                    {t('common.cancel', { defaultValue: 'Cancel' })}
                  </button>
                  <button
                    type="button"
                    disabled={!rejectReason.trim()}
                    onClick={async () => {
                      if (!rejectModal.submissionId) return;
                      if (!rejectReason.trim()) return;
                      try {
                        await dispatch(rejectSubmission({ submissionId: rejectModal.submissionId, moderatorNotes: rejectReason.trim() })).unwrap();
                        toast.success(t('admin.reject', { defaultValue: 'Reject' }));
                        setRejectModal({ open: false, submissionId: null });
                        dispatch(fetchSubmissions({ status: 'pending' }));
                      } catch {
                        toast.error(t('admin.failedToReject', { defaultValue: 'Failed to reject submission' }));
                      }
                    }}
                    className="flex-1 bg-red-600 hover:bg-red-700 disabled:bg-gray-300 disabled:cursor-not-allowed disabled:hover:bg-gray-300 text-white font-semibold py-2 px-4 rounded-lg transition-colors"
                  >
                    {t('admin.reject', { defaultValue: 'Reject' })}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
