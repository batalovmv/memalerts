import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';

import type { Meme } from '@/types';

import { AllMemesPanel } from '@/components/dashboard/AllMemesPanel';
import { PendingSubmissionsPanel } from '@/components/dashboard/PendingSubmissionsPanel';
import Header from '@/components/Header';
import { ApproveSubmissionModal } from '@/features/dashboard/ui/modals/ApproveSubmissionModal';
import { NeedsChangesModal } from '@/features/dashboard/ui/modals/NeedsChangesModal';
import { RejectSubmissionModal } from '@/features/dashboard/ui/modals/RejectSubmissionModal';
import { useAutoplayMemes } from '@/hooks/useAutoplayMemes';
import { api } from '@/lib/api';
import { Button, PageShell, Pill, Spinner } from '@/shared/ui';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { store } from '@/store/index';
import { approveSubmission, fetchSubmissions, needsChangesSubmission, rejectSubmission } from '@/store/slices/submissionsSlice';

const SubmitModal = lazy(() => import('@/components/SubmitModal'));
const MemeModal = lazy(() => import('@/components/MemeModal'));

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

  const setPanel = useCallback((next: 'submissions' | 'memes' | null, replace = false) => {
    const nextParams = new URLSearchParams(searchParams);
    // Back-compat: remove older tab param
    nextParams.delete('tab');
    if (next) nextParams.set('panel', next);
    else nextParams.delete('panel');
    setSearchParams(nextParams, { replace });
  }, [searchParams, setSearchParams]);

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
  }, [panel, searchParams, setPanel]);

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
        const data = await api.get<{ stats?: { memesCount?: number } }>(`/channels/${slug}`, { params: { includeMemes: false } });
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

  const handleApprove = async () => {
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
  };

  const handleReject = async () => {
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
  };

  const handleNeedsChanges = async () => {
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
        }),
      );
      return;
    }
    const packed = JSON.stringify({ v: 1, codes, message: msg });
    try {
      await dispatch(needsChangesSubmission({ submissionId: needsChangesModal.submissionId, moderatorNotes: packed })).unwrap();
      toast.success(t('submissions.sentForChanges', { defaultValue: 'Sent for changes.' }));
      setNeedsChangesModal({ open: false, submissionId: null });
      dispatch(fetchSubmissions({ status: 'pending', limit: 20, offset: 0 }));
    } catch {
      toast.error(t('submissions.failedToSendForChanges', { defaultValue: 'Failed to send for changes.' }));
    }
  };

  const needsChangesRemainingResubmits = (() => {
    const s = submissions.find((x) => x.id === needsChangesModal.submissionId);
    const revision = Math.max(0, Math.min(2, Number(s?.revision ?? 0) || 0));
    return Math.max(0, 2 - revision);
  })();

  if (authLoading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex items-center gap-3 text-gray-700 dark:text-gray-200">
          <Spinner className="h-5 w-5" />
          <div className="text-base font-semibold">{t('common.loading', { defaultValue: 'Loading…' })}</div>
        </div>
      </div>
    );
  }

  return (
    <>
      <PageShell header={<Header />}>
        <div className="section-gap">
          <div>
            <h1 className="text-3xl font-bold mb-2 dark:text-white">{t('dashboard.title', 'Dashboard')}</h1>
            <p className="text-gray-600 dark:text-gray-400">
              {t('dashboard.subtitle', 'Manage your memes and channel settings')}
            </p>
          </div>

          {user.channelId ? (
            <>
              {/* Quick Actions Cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
              {/* Submit Meme Card - Primary */}
              <div className="surface surface-hover p-6 flex flex-col min-h-[210px]">
                <h2 className="text-lg font-semibold mb-2 dark:text-white">{t('dashboard.quickActions.submitMeme', 'Submit Meme')}</h2>
                <p className="text-gray-600 dark:text-gray-400 text-sm mb-4">
                  {t('dashboard.quickActions.submitMemeDescription', 'Add a meme directly to your pool')}
                </p>
                <Button
                  onClick={() => setIsSubmitModalOpen(true)}
                  variant="primary"
                  size="lg"
                  className="mt-auto w-full"
                >
                  {t('dashboard.quickActions.submitMemeButton', 'Submit Meme')}
                </Button>
              </div>

              {/* Pending Submissions Card - Secondary */}
              <div className="surface surface-hover p-6 flex flex-col min-h-[210px]">
                <div className="flex items-center justify-between mb-2">
                  <h2 className="text-lg font-semibold dark:text-white">{t('dashboard.quickActions.pendingSubmissions', 'Pending Submissions')}</h2>
                  {pendingSubmissionsCount > 0 && (
                    <Pill variant="danger" size="md" title={t('dashboard.pendingCount', { defaultValue: '{{count}} pending', count: pendingSubmissionsCount })}>
                      {pendingSubmissionsCount}
                    </Pill>
                  )}
                </div>
                <p className="text-gray-600 dark:text-gray-400 text-sm mb-4">
                  {t('dashboard.quickActions.pendingSubmissionsDescription', 'Review and approve meme submissions')}
                </p>
                <Button
                  onClick={() => {
                    const next = panel === 'submissions' ? null : 'submissions';
                    if (next) scrollToPanelIfMobile('submissions');
                    setPanel(next);
                  }}
                  variant={panel === 'submissions' || pendingSubmissionsCount > 0 ? 'danger' : 'secondary'}
                  size="lg"
                  className="mt-auto w-full"
                >
                  {pendingSubmissionsCount > 0 
                    ? t('dashboard.quickActions.pendingSubmissionsButton', `${pendingSubmissionsCount} Pending`, { count: pendingSubmissionsCount })
                    : t('dashboard.quickActions.noPendingSubmissions', 'No Pending')
                  }
                </Button>
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
                <Button
                  onClick={() => {
                    const next = panel === 'memes' ? null : 'memes';
                    if (next) scrollToPanelIfMobile('memes');
                    setPanel(next);
                  }}
                  variant={panel === 'memes' ? 'primary' : 'secondary'}
                  size="lg"
                  className="mt-auto w-full"
                >
                  {panel === 'memes'
                    ? t('common.close', { defaultValue: 'Close' })
                    : t('dashboard.quickActions.openAllMemes', { defaultValue: 'Open' })}
                </Button>
              </div>

              {/* Settings Card - Tertiary */}
              <div className="surface surface-hover p-6 flex flex-col min-h-[210px]">
                <h2 className="text-lg font-semibold mb-2 dark:text-white">{t('dashboard.quickActions.settings', 'Settings')}</h2>
                <p className="text-gray-600 dark:text-gray-400 text-sm mb-4">
                  {t('dashboard.quickActions.settingsDescription', 'Configure your channel and preferences')}
                </p>
                <Button
                  onClick={() => navigate('/settings?tab=settings')}
                  variant="secondary"
                  size="lg"
                  className="mt-auto w-full"
                >
                  {t('dashboard.quickActions.settingsButton', 'Open Settings')}
                </Button>
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
              <div className="text-base font-semibold text-gray-900 dark:text-white">
                {t('dashboard.noChannelTitle', { defaultValue: "You're not a streamer yet" })}
              </div>
              <p className="mt-2 text-gray-600 dark:text-gray-400">
                {t('dashboard.noChannel', { defaultValue: "You don't have a channel yet. You can still browse memes and request beta access." })}
              </p>
              <div className="mt-5 flex flex-col sm:flex-row gap-3">
                <Button type="button" variant="secondary" onClick={() => navigate('/search')}>
                  {t('dashboard.browseMemes', { defaultValue: 'Browse memes' })}
                </Button>
                <Button type="button" variant="primary" onClick={() => navigate('/settings?tab=beta')}>
                  {t('dashboard.requestBeta', { defaultValue: 'Request beta access' })}
                </Button>
              </div>
            </div>
          )}
        </div>
      </PageShell>

      {/* Submit Modal */}
      <Suspense fallback={null}>
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
      </Suspense>

      <ApproveSubmissionModal
        isOpen={approveModal.open}
        priceCoins={priceCoins}
        onPriceCoinsChange={setPriceCoins}
        onClose={() => setApproveModal({ open: false, submissionId: null })}
        onApprove={handleApprove}
      />

      <NeedsChangesModal
        isOpen={needsChangesModal.open}
        remainingResubmits={needsChangesRemainingResubmits}
        preset={needsChangesPreset}
        onPresetChange={setNeedsChangesPreset}
        message={needsChangesText}
        onMessageChange={setNeedsChangesText}
        onClose={() => setNeedsChangesModal({ open: false, submissionId: null })}
        onSend={handleNeedsChanges}
      />

      <RejectSubmissionModal
        isOpen={rejectModal.open}
        rejectReason={rejectReason}
        onRejectReasonChange={setRejectReason}
        onClose={() => setRejectModal({ open: false, submissionId: null })}
        onReject={handleReject}
      />
    </>
  );
}


