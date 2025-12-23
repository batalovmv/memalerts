import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAppSelector, useAppDispatch } from '@/store/hooks';
import { store } from '@/store/index';
import { fetchSubmissions, approveSubmission, rejectSubmission, needsChangesSubmission } from '@/store/slices/submissionsSlice';
import { api } from '@/lib/api';
import Header from '@/components/Header';
import SubmitModal from '@/components/SubmitModal';
import MemeModal from '@/components/MemeModal';
import toast from 'react-hot-toast';
import type { Meme } from '@/types';
import { useAutoplayMemes } from '@/hooks/useAutoplayMemes';
import { PendingSubmissionsPanel } from '@/components/dashboard/PendingSubmissionsPanel';
import { AllMemesPanel } from '@/components/dashboard/AllMemesPanel';

export default function DashboardPage() {
  const { t } = useTranslation();
  const { user, loading: authLoading } = useAppSelector((state) => state.auth);
  const { submissions, loading: submissionsLoading, loadingMore: submissionsLoadingMore, total: submissionsTotal } = useAppSelector((state) => state.submissions);
  const [memesCount, setMemesCount] = useState<number | null>(null);
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [isSubmitModalOpen, setIsSubmitModalOpen] = useState(false);
  const submissionsLoadedRef = useRef(false);
  const [approveModal, setApproveModal] = useState<{ open: boolean; submissionId: string | null }>({
    open: false,
    submissionId: null,
  });
  const [rejectModal, setRejectModal] = useState<{ open: boolean; submissionId: string | null }>({
    open: false,
    submissionId: null,
  });
  const [needsChangesModal, setNeedsChangesModal] = useState<{ open: boolean; submissionId: string | null }>({
    open: false,
    submissionId: null,
  });
  const [priceCoins, setPriceCoins] = useState('100');
  const [rejectReason, setRejectReason] = useState('');
  const [needsChangesPreset, setNeedsChangesPreset] = useState<{ badTitle: boolean; noTags: boolean; other: boolean }>({
    badTitle: false,
    noTags: false,
    other: false,
  });
  const [needsChangesText, setNeedsChangesText] = useState('');
  const [selectedMeme, setSelectedMeme] = useState<Meme | null>(null);
  const [isMemeModalOpen, setIsMemeModalOpen] = useState(false);
  const { autoplayMemesEnabled } = useAutoplayMemes();
  const submissionsPanelRef = useRef<HTMLDivElement | null>(null);
  const memesPanelRef = useRef<HTMLDivElement | null>(null);

  const panel = (searchParams.get('panel') || '').toLowerCase();
  const tab = (searchParams.get('tab') || '').toLowerCase();
  const isPanelOpen = panel === 'submissions' || panel === 'memes';

  const setPanel = (next: 'submissions' | 'memes' | null, replace = false) => {
    const nextParams = new URLSearchParams(searchParams);
    // Back-compat: remove older tab param
    nextParams.delete('tab');
    if (next) nextParams.set('panel', next);
    else nextParams.delete('panel');
    setSearchParams(nextParams, { replace });
  };

  const scrollToPanelIfMobile = (next: 'submissions' | 'memes') => {
    const isMobile = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(max-width: 768px)').matches;
    if (!isMobile) return;
    const target = next === 'submissions' ? submissionsPanelRef.current : memesPanelRef.current;
    if (!target) return;
    requestAnimationFrame(() => {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  // When panel is opened via URL (e.g. from Header bell), auto-scroll on mobile.
  useEffect(() => {
    if (panel === 'submissions') scrollToPanelIfMobile('submissions');
    if (panel === 'memes') scrollToPanelIfMobile('memes');
  }, [panel]);

  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/');
    }
  }, [user, authLoading, navigate]);

  // Removed role restrictions - Dashboard is accessible to all users

  // Back-compat: if someone navigates to /dashboard?tab=submissions, open the submissions panel.
  // This must work even when Dashboard is already mounted (e.g. via Header bell click).
  useEffect(() => {
    const tab = (searchParams.get('tab') || '').toLowerCase();
    if (tab === 'submissions' && panel !== 'submissions') {
      setPanel('submissions', true);
    }
  }, [panel, searchParams]);

  useEffect(() => {
    // (debug logging removed)
  }, [panel, tab, isPanelOpen, searchParams]);

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
        dispatch(fetchSubmissions({ status: 'pending', limit: 20, offset: 0 }));
      } else if (hasFreshData) {
        submissionsLoadedRef.current = true; // Mark as loaded even if we didn't fetch
      }
    }
    // Reset ref when user changes
    if (!userId || !userChannelId) {
      submissionsLoadedRef.current = false;
    }
  }, [user?.id, user?.role, user?.channelId, dispatch]); // Use user?.id instead of user to prevent unnecessary re-runs

  // Load memes count (lightweight) for own channel (do NOT load all memes here)
  useEffect(() => {
    if (!user?.channel?.slug) return;
    void (async () => {
      try {
        const slug = user.channel?.slug;
        if (!slug) return;
        const data = await api.get<any>(`/channels/${slug}`, { params: { includeMemes: false } });
        const count = data?.stats?.memesCount;
        if (typeof count === 'number') setMemesCount(count);
      } catch {
        // ignore
      }
    })();
  }, [user?.channel?.slug]);

  const pendingSubmissionsCount =
    typeof submissionsTotal === 'number'
      ? submissionsTotal
      : submissions.filter(s => s.status === 'pending').length;

  const myChannelMemesCount = memesCount ?? 0;

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
            {/* Quick Actions Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6 mb-6">
              {/* Submit Meme Card - Primary */}
              <div className="surface surface-hover p-6 flex flex-col min-h-[210px]">
                <h2 className="text-lg font-semibold mb-2 dark:text-white">{t('dashboard.quickActions.submitMeme', 'Submit Meme')}</h2>
                <p className="text-gray-600 dark:text-gray-400 text-sm mb-4">
                  {t('dashboard.quickActions.submitMemeDescription', 'Add a meme directly to your pool')}
                </p>
                <button
                  onClick={() => setIsSubmitModalOpen(true)}
                  className="mt-auto w-full bg-primary hover:bg-secondary text-white font-semibold py-3 px-6 rounded-lg transition-colors"
                >
                  {t('dashboard.quickActions.submitMemeButton', 'Submit Meme')}
                </button>
              </div>

              {/* Pending Submissions Card - Secondary */}
              <div className="surface surface-hover p-6 flex flex-col min-h-[210px]">
                <div className="flex items-center justify-between mb-2">
                  <h2 className="text-lg font-semibold dark:text-white">{t('dashboard.quickActions.pendingSubmissions', 'Pending Submissions')}</h2>
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
                  onClick={() => {
                    const next = panel === 'submissions' ? null : 'submissions';
                    if (next) scrollToPanelIfMobile('submissions');
                    setPanel(next);
                  }}
                  className={`mt-auto w-full font-semibold py-3 px-6 rounded-lg transition-colors ${
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
              <div className="surface surface-hover p-6 flex flex-col min-h-[210px]">
                <div className="flex items-center justify-between mb-2">
                  <h2 className="text-lg font-semibold dark:text-white">
                    {t('dashboard.quickActions.allMemes', { defaultValue: 'All memes' })}
                  </h2>
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    {memesCount === null ? '…' : myChannelMemesCount}
                  </span>
                </div>
                <p className="text-gray-600 dark:text-gray-400 text-sm mb-4">
                  {t('dashboard.quickActions.allMemesDescription', { defaultValue: 'Browse and edit your meme library' })}
                </p>
                <button
                  onClick={() => {
                    const next = panel === 'memes' ? null : 'memes';
                    if (next) scrollToPanelIfMobile('memes');
                    setPanel(next);
                  }}
                  className={`mt-auto w-full font-semibold py-3 px-6 rounded-lg transition-colors ${
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
              <div className="surface surface-hover p-6 flex flex-col min-h-[210px]">
                <h2 className="text-lg font-semibold mb-2 dark:text-white">{t('dashboard.quickActions.settings', 'Settings')}</h2>
                <p className="text-gray-600 dark:text-gray-400 text-sm mb-4">
                  {t('dashboard.quickActions.settingsDescription', 'Configure your channel and preferences')}
                </p>
                <button
                  onClick={() => navigate('/settings?tab=settings')}
                  className="mt-auto w-full bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200 font-semibold py-3 px-6 rounded-lg transition-colors"
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
                <div ref={submissionsPanelRef}>
                  <PendingSubmissionsPanel
                    isOpen={panel === 'submissions'}
                    submissions={submissions}
                    submissionsLoading={submissionsLoading}
                    submissionsLoadingMore={submissionsLoadingMore}
                    pendingCount={pendingSubmissionsCount}
                    total={submissionsTotal}
                    onClose={() => setPanel(null)}
                    onLoadMore={() => {
                      const offset = submissions.length;
                      // If we know total and already loaded everything, skip.
                      if (typeof submissionsTotal === 'number' && offset >= submissionsTotal) return;
                      dispatch(fetchSubmissions({ status: 'pending', limit: 20, offset }));
                    }}
                    onApprove={(submissionId) => {
                      setApproveModal({ open: true, submissionId });
                      setPriceCoins('100');
                    }}
                    onReject={(submissionId) => {
                      setRejectModal({ open: true, submissionId });
                      setRejectReason('');
                    }}
                    onNeedsChanges={(submissionId) => {
                      setNeedsChangesModal({ open: true, submissionId });
                      setNeedsChangesPreset({ badTitle: false, noTags: false, other: false });
                      setNeedsChangesText('');
                    }}
                  />
                </div>

                <div ref={memesPanelRef}>
                  <AllMemesPanel
                    isOpen={panel === 'memes'}
                    channelId={user.channelId}
                    autoplayPreview={autoplayMemesEnabled ? 'autoplayMuted' : 'hoverWithSound'}
                    onClose={() => setPanel(null)}
                    onSelectMeme={(meme) => {
                      setSelectedMeme(meme);
                      setIsMemeModalOpen(true);
                    }}
                  />
                </div>
              </div>
            </div>

          </>
        ) : (
          <div className="surface p-6">
            <p className="text-gray-600 dark:text-gray-400">
              {t('dashboard.noChannel', "You don't have a channel yet. Create one to start using the platform.")}
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
            // All memes panel is loaded via paginated search; no global refresh needed here.
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
                        dispatch(fetchSubmissions({ status: 'pending', limit: 20, offset: 0 }));
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

      {/* Needs Changes Modal (Dashboard) */}
      {needsChangesModal.open && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="fixed inset-0 bg-black/50 transition-opacity" onClick={() => setNeedsChangesModal({ open: false, submissionId: null })} />
          <div className="flex min-h-full items-center justify-center p-4">
            <div className="relative bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full">
              <div className="sticky top-0 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-4 flex justify-between items-center">
                <h2 className="text-2xl font-bold dark:text-white">
                  {t('submissions.needsChangesTitle', { defaultValue: 'Send for changes' })}
                </h2>
                <button
                  onClick={() => setNeedsChangesModal({ open: false, submissionId: null })}
                  className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                  aria-label={t('common.close', { defaultValue: 'Close' })}
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="p-6 space-y-4">
                {(() => {
                  const s = submissions.find((x) => x.id === needsChangesModal.submissionId);
                  const revision = Math.max(0, Math.min(2, Number(s?.revision ?? 0) || 0));
                  const left = Math.max(0, 2 - revision);
                  return (
                    <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
                      <p className="text-sm text-amber-900 dark:text-amber-100 font-medium">
                        {t('submissions.resubmitsInfo', {
                          defaultValue: 'User can resubmit up to {{max}} times. Remaining: {{left}}.',
                          max: 2,
                          left,
                        })}
                      </p>
                    </div>
                  );
                })()}

                <div className="space-y-2">
                  <div className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    {t('submissions.quickReasons', { defaultValue: 'Quick reasons' })}
                  </div>
                  <label className="flex items-center gap-2 text-sm text-gray-800 dark:text-gray-100">
                    <input
                      type="checkbox"
                      checked={needsChangesPreset.badTitle}
                      onChange={(e) => setNeedsChangesPreset((p) => ({ ...p, badTitle: e.target.checked }))}
                    />
                    {t('submissions.reasonBadTitle', { defaultValue: 'Title is not OK' })}
                  </label>
                  <label className="flex items-center gap-2 text-sm text-gray-800 dark:text-gray-100">
                    <input
                      type="checkbox"
                      checked={needsChangesPreset.noTags}
                      onChange={(e) => setNeedsChangesPreset((p) => ({ ...p, noTags: e.target.checked }))}
                    />
                    {t('submissions.reasonNoTags', { defaultValue: 'No tags' })}
                  </label>
                  <label className="flex items-center gap-2 text-sm text-gray-800 dark:text-gray-100">
                    <input
                      type="checkbox"
                      checked={needsChangesPreset.other}
                      onChange={(e) => setNeedsChangesPreset((p) => ({ ...p, other: e.target.checked }))}
                    />
                    {t('submissions.reasonOther', { defaultValue: 'Other (write below)' })}
                  </label>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    {t('submissions.messageToUser', { defaultValue: 'Message to user (optional)' })}
                  </label>
                  <textarea
                    value={needsChangesText}
                    onChange={(e) => setNeedsChangesText(e.target.value)}
                    rows={4}
                    className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-2 focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                    placeholder={t('submissions.messagePlaceholder', { defaultValue: 'Explain what to fix…' })}
                  />
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    {t('submissions.messageHint', { defaultValue: 'This will be shown to the submitter.' })}
                  </p>
                </div>

                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setNeedsChangesModal({ open: false, submissionId: null })}
                    className="flex-1 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200 font-semibold py-2 px-4 rounded-lg transition-colors"
                  >
                    {t('common.cancel', { defaultValue: 'Cancel' })}
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      if (!needsChangesModal.submissionId) return;
                      const codes: string[] = [];
                      if (needsChangesPreset.badTitle) codes.push('bad_title');
                      if (needsChangesPreset.noTags) codes.push('no_tags');
                      if (needsChangesPreset.other) codes.push('other');
                      const msg = needsChangesText.trim();
                      const hasReason = codes.length > 0 || msg.length > 0;
                      const otherNeedsText = needsChangesPreset.other && msg.length === 0;
                      if (!hasReason || otherNeedsText) {
                        toast.error(
                          t('submissions.needsChangesReasonRequired', {
                            defaultValue: 'Select a reason or write a message.',
                          })
                        );
                        return;
                      }
                      const packed = JSON.stringify({ v: 1, codes, message: msg });
                      try {
                        await dispatch(needsChangesSubmission({ submissionId: needsChangesModal.submissionId, moderatorNotes: packed })).unwrap();
                        toast.success(t('submissions.sentForChanges', { defaultValue: 'Sent for changes.' }));
                        setNeedsChangesModal({ open: false, submissionId: null });
                        dispatch(fetchSubmissions({ status: 'pending', limit: 20, offset: 0 }));
                      } catch (e: any) {
                        toast.error(t('submissions.failedToSendForChanges', { defaultValue: 'Failed to send for changes.' }));
                      }
                    }}
                    className="flex-1 bg-amber-600 hover:bg-amber-700 text-white font-semibold py-2 px-4 rounded-lg transition-colors"
                  >
                    {t('submissions.sendForChanges', { defaultValue: 'Send' })}
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
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    {t('admin.rejectionReason', { defaultValue: 'Reason (optional)' })}
                  </label>
                  <textarea
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    rows={4}
                    className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-2 focus:ring-2 focus:ring-red-500 focus:border-red-500"
                    placeholder={t('admin.rejectionReasonPlaceholder', { defaultValue: 'Enter a reason (optional)…' })}
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
                    onClick={async () => {
                      if (!rejectModal.submissionId) return;
                      const notes = rejectReason.trim() ? rejectReason.trim() : null;
                      try {
                        await dispatch(rejectSubmission({ submissionId: rejectModal.submissionId, moderatorNotes: notes })).unwrap();
                        toast.success(t('admin.reject', { defaultValue: 'Reject' }));
                        setRejectModal({ open: false, submissionId: null });
                        dispatch(fetchSubmissions({ status: 'pending', limit: 20, offset: 0 }));
                      } catch {
                        toast.error(t('admin.failedToReject', { defaultValue: 'Failed to reject submission' }));
                      }
                    }}
                    className="flex-1 bg-red-600 hover:bg-red-700 text-white font-semibold py-2 px-4 rounded-lg transition-colors"
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


