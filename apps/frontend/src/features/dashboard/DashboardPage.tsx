import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';

import type { Meme } from '@/types';

import { AllMemesPanel } from '@/components/dashboard/AllMemesPanel';
import { PendingSubmissionsPanel } from '@/components/dashboard/PendingSubmissionsPanel';
import Header from '@/components/Header';
import SecretCopyField from '@/components/SecretCopyField';
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

type ToggleSwitchProps = {
  checked: boolean;
  disabled?: boolean;
  busy?: boolean;
  onChange: (next: boolean) => void;
  ariaLabel?: string;
};

function ToggleSwitch({ checked, disabled, busy, onChange, ariaLabel }: ToggleSwitchProps) {
  const isDisabled = !!disabled || !!busy;
  return (
    <label className={`relative inline-flex items-center cursor-pointer shrink-0 ${isDisabled ? 'opacity-80' : ''}`}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="sr-only peer"
        disabled={isDisabled}
        aria-label={ariaLabel}
      />
      <div
        className={[
          'relative w-11 h-6 rounded-full transition-colors',
          'bg-gray-200 dark:bg-gray-600',
          'peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/20 dark:peer-focus:ring-primary/30',
          'peer-checked:bg-primary',
        ].join(' ')}
      >
        <div
          className={[
            'absolute top-[2px] left-[2px] h-5 w-5 rounded-full bg-white border border-gray-300 dark:border-gray-600',
            'transition-transform',
            checked ? 'translate-x-full' : 'translate-x-0',
            busy ? 'grid place-items-center' : '',
          ].join(' ')}
        >
          {busy ? <Spinner className="h-3 w-3 border-[2px]" /> : null}
        </div>
      </div>
    </label>
  );
}

type SubmissionsControlLinks = { enable: string; disable: string; toggle?: string };
type SubmissionsControlLinkResponse =
  | { hasToken: true; revealable: true; token: string; links: SubmissionsControlLinks }
  | { hasToken: true; revealable: false; message?: string };

type BotIntegration = { provider: string; enabled?: boolean | null };
type PublicSubmissionsStatusResponse = { ok: true; submissions: { enabled: boolean; onlyWhenLive: boolean } };

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

  const [submissionsEnabled, setSubmissionsEnabled] = useState<boolean | null>(null);
  const [submissionsOnlyWhenLive, setSubmissionsOnlyWhenLive] = useState<boolean | null>(null);
  const [savingSubmissionsSettings, setSavingSubmissionsSettings] = useState<null | 'enabled' | 'onlyWhenLive'>(null);
  const [submissionsControl, setSubmissionsControl] = useState<null | { revealable: boolean; token?: string; links?: SubmissionsControlLinks; message?: string }>(
    null
  );
  const [loadingSubmissionsControl, setLoadingSubmissionsControl] = useState(false);
  const [rotatingSubmissionsControl, setRotatingSubmissionsControl] = useState(false);
  const [submissionsControlStatus, setSubmissionsControlStatus] = useState<null | { enabled: boolean; onlyWhenLive: boolean }>(null);
  const [loadingSubmissionsControlStatus, setLoadingSubmissionsControlStatus] = useState(false);

  const [bots, setBots] = useState<BotIntegration[]>([]);
  const [botsLoaded, setBotsLoaded] = useState(false);
  const [botsLoading, setBotsLoading] = useState(false);

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
        const data = await api.get<{
          stats?: { memesCount?: number };
          submissionsEnabled?: boolean;
          submissionsOnlyWhenLive?: boolean;
        }>(`/channels/${slug}`, { params: { includeMemes: false } });
        const count = data?.stats?.memesCount;
        if (typeof count === 'number') setMemesCount(count);
        if (typeof data?.submissionsEnabled === 'boolean') setSubmissionsEnabled(data.submissionsEnabled);
        if (typeof data?.submissionsOnlyWhenLive === 'boolean') setSubmissionsOnlyWhenLive(data.submissionsOnlyWhenLive);
      } catch {
        // ignore
      }
    })();
  }, [user?.channel?.slug]);

  const saveSubmissionSettings = useCallback(
    async (patch: { submissionsEnabled?: boolean; submissionsOnlyWhenLive?: boolean }, kind: 'enabled' | 'onlyWhenLive') => {
      if (!user?.channelId) return;
      if (savingSubmissionsSettings) return;
      try {
        setSavingSubmissionsSettings(kind);
        const resp = await api.patch<{
          submissionsEnabled?: boolean;
          submissionsOnlyWhenLive?: boolean;
        }>('/streamer/channel/settings', patch);
        // Prefer server response, but keep local optimistic value if missing.
        if (typeof resp?.submissionsEnabled === 'boolean') setSubmissionsEnabled(resp.submissionsEnabled);
        if (typeof resp?.submissionsOnlyWhenLive === 'boolean') setSubmissionsOnlyWhenLive(resp.submissionsOnlyWhenLive);
        toast.success(t('dashboard.submissions.saved', { defaultValue: 'Saved' }));
      } catch (error: unknown) {
        const apiError = error as { response?: { data?: { error?: string } } };
        toast.error(apiError.response?.data?.error || t('admin.failedToSaveSettings', { defaultValue: 'Failed to save settings' }));
        // Re-fetch to resync (best-effort)
        try {
          const slug = user?.channel?.slug;
          if (slug) {
            const data = await api.get<{ submissionsEnabled?: boolean; submissionsOnlyWhenLive?: boolean }>(`/channels/${slug}`, {
              params: { includeMemes: false },
            });
            if (typeof data?.submissionsEnabled === 'boolean') setSubmissionsEnabled(data.submissionsEnabled);
            if (typeof data?.submissionsOnlyWhenLive === 'boolean') setSubmissionsOnlyWhenLive(data.submissionsOnlyWhenLive);
          }
        } catch {
          // ignore
        }
      } finally {
        setSavingSubmissionsSettings(null);
      }
    },
    [savingSubmissionsSettings, t, user?.channel?.slug, user?.channelId]
  );

  const loadSubmissionsControlLink = useCallback(async () => {
    if (loadingSubmissionsControl) return;
    try {
      setLoadingSubmissionsControl(true);
      const resp = await api.get<SubmissionsControlLinkResponse>('/streamer/submissions-control/link', { timeout: 12000 });
      if (resp.revealable) {
        setSubmissionsControl({ revealable: true, token: resp.token, links: resp.links });
      } else {
        setSubmissionsControl({ revealable: false, message: resp.message || t('dashboard.submissionsControl.revealOnce', { defaultValue: 'Link is hidden. Rotate to reveal a new one.' }) });
      }
    } catch (error: unknown) {
      const apiError = error as { response?: { data?: { error?: string } } };
      toast.error(apiError.response?.data?.error || t('dashboard.submissionsControl.failedToLoad', { defaultValue: 'Failed to load link' }));
    } finally {
      setLoadingSubmissionsControl(false);
    }
  }, [loadingSubmissionsControl, t]);

  const refreshSubmissionsControlStatus = useCallback(
    async (token: string) => {
      const trimmed = String(token || '').trim();
      if (!trimmed) return;
      if (loadingSubmissionsControlStatus) return;
      try {
        setLoadingSubmissionsControlStatus(true);
        const resp = await api.get<PublicSubmissionsStatusResponse>('/public/submissions/status', {
          params: { token: trimmed },
          timeout: 12000,
          // Avoid caches; this is meant to reflect current state.
          headers: { 'Cache-Control': 'no-store' },
        });
        if (resp?.ok && resp.submissions) {
          setSubmissionsControlStatus({
            enabled: !!resp.submissions.enabled,
            onlyWhenLive: !!resp.submissions.onlyWhenLive,
          });
        }
      } catch (error: unknown) {
        const apiError = error as { response?: { status?: number; data?: { error?: string } } };
        if (apiError.response?.status === 404) {
          setSubmissionsControlStatus(null);
          toast.error(t('dashboard.submissionsControl.invalidToken', { defaultValue: 'Token is invalid. Rotate the link to generate a new one.' }));
        } else {
          toast.error(t('dashboard.submissionsControl.failedToLoadStatus', { defaultValue: 'Failed to load status' }));
        }
      } finally {
        setLoadingSubmissionsControlStatus(false);
      }
    },
    [loadingSubmissionsControlStatus, t]
  );

  const rotateSubmissionsControlLink = useCallback(async () => {
    if (rotatingSubmissionsControl) return;
    try {
      setRotatingSubmissionsControl(true);
      const resp = await api.post<{ ok: true; token: string; links: SubmissionsControlLinks }>(
        '/streamer/submissions-control/link/rotate',
        {},
        { timeout: 12000 }
      );
      if (resp?.ok) {
        setSubmissionsControl({ revealable: true, token: resp.token, links: resp.links });
        toast.success(t('dashboard.submissionsControl.rotated', { defaultValue: 'Link updated. Paste the new URL into StreamerBot.' }));
      }
    } catch (error: unknown) {
      const apiError = error as { response?: { data?: { error?: string } } };
      toast.error(apiError.response?.data?.error || t('dashboard.submissionsControl.failedToRotate', { defaultValue: 'Failed to rotate link' }));
    } finally {
      setRotatingSubmissionsControl(false);
    }
  }, [rotatingSubmissionsControl, t]);

  // Auto-load token status only when token is revealed (Rotate / first reveal).
  useEffect(() => {
    const token = (submissionsControl?.revealable && submissionsControl?.token) ? submissionsControl.token : '';
    if (!token) return;
    void refreshSubmissionsControlStatus(token);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submissionsControl?.token]);

  const loadBots = useCallback(async () => {
    if (botsLoading) return;
    try {
      setBotsLoading(true);
      const resp = await api.get<{ items?: BotIntegration[] }>('/streamer/bots', { timeout: 12000 });
      const list = Array.isArray(resp?.items) ? resp.items : [];
      setBots(list);
      setBotsLoaded(true);
    } catch {
      setBotsLoaded(true);
    } finally {
      setBotsLoading(false);
    }
  }, [botsLoading]);

  useEffect(() => {
    if (!user) return;
    if (user.role !== 'streamer' && user.role !== 'admin') return;
    if (!botsLoaded) void loadBots();
  }, [botsLoaded, loadBots, user]);

  const visibleBots = bots.filter((b) => {
    const provider = String(b?.provider || '').trim().toLowerCase();
    if (!provider) return false;
    return true;
  });
  const anyBotEnabled = visibleBots.some((b) => b?.enabled === true);
  const allBotsEnabled = visibleBots.length > 0 && visibleBots.every((b) => b?.enabled === true);

  const toggleAllBots = useCallback(
    async (nextEnabled: boolean) => {
      if (botsLoading) return;
      // Optimistic
      setBots((prev) => prev.map((b) => ({ ...b, enabled: nextEnabled })));
      try {
        setBotsLoading(true);
        const providersToToggle = visibleBots;
        const uniqueProviders = Array.from(
          new Set(
            providersToToggle
              .map((b) => String(b?.provider || '').trim())
              .map((p) => p.toLowerCase())
              .filter(Boolean)
          )
        );
        const results = await Promise.allSettled(
          uniqueProviders.map((provider) => api.patch(`/streamer/bots/${encodeURIComponent(provider)}`, { enabled: nextEnabled }))
        );
        const rejected = results
          .map((r, idx) => ({ r, provider: uniqueProviders[idx] || 'unknown' }))
          .filter((x) => x.r.status === 'rejected') as Array<{ r: PromiseRejectedResult; provider: string }>;
        const failed = rejected.length;
        if (failed > 0) {
          const hasYouTubeRelink = rejected.some((x) => {
            const e = x.r.reason as { response?: { status?: number; data?: { code?: unknown; needsRelink?: unknown } } };
            return e?.response?.status === 412 && e?.response?.data?.code === 'YOUTUBE_RELINK_REQUIRED';
          });
          if (hasYouTubeRelink) {
            toast.error(
              t('dashboard.bots.youtubeRelinkRequired', {
                defaultValue: 'YouTube needs re-linking (missing permissions). Open Settings → Bot to reconnect.',
              })
            );
          }
          toast.error(
            t('dashboard.bots.failedPartial', {
              defaultValue: 'Some bots failed to update. Please retry.',
            })
          );
        } else {
          toast.success(
            nextEnabled
              ? t('dashboard.bots.enabledAll', { defaultValue: 'All bots enabled.' })
              : t('dashboard.bots.disabledAll', { defaultValue: 'All bots disabled.' })
          );
        }
        // Re-load best-effort to reflect backend truth
        void loadBots();
      } catch {
        toast.error(t('dashboard.bots.failedAll', { defaultValue: 'Failed to update bots' }));
        void loadBots();
      } finally {
        setBotsLoading(false);
      }
    },
    [botsLoading, loadBots, t, visibleBots]
  );

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

              {/* Controls */}
              {(user.role === 'streamer' || user.role === 'admin') && (
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mt-6">
                  {/* Submissions control */}
                  <div className="surface surface-hover p-6">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <h2 className="text-lg font-semibold dark:text-white">
                          {t('dashboard.submissionsControl.title', { defaultValue: 'Submissions' })}
                        </h2>
                        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                          {t('dashboard.submissionsControl.subtitle', { defaultValue: 'Control whether viewers can submit memes.' })}
                        </p>
                      </div>
                    </div>

                    <div className="mt-5 space-y-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <div className="font-medium text-gray-900 dark:text-white">
                            {t('dashboard.submissions.enabledTitle', { defaultValue: 'Allow submissions' })}
                          </div>
                          <div className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                            {t('dashboard.submissions.enabledHint', { defaultValue: 'If disabled, viewers will see a message instead of the submit form.' })}
                          </div>
                        </div>
                        <ToggleSwitch
                          checked={submissionsEnabled ?? true}
                          busy={savingSubmissionsSettings === 'enabled'}
                          disabled={submissionsEnabled === null}
                          ariaLabel={t('dashboard.submissions.enabledTitle', { defaultValue: 'Allow submissions' })}
                          onChange={(next) => {
                            setSubmissionsEnabled(next);
                            void saveSubmissionSettings({ submissionsEnabled: next }, 'enabled');
                          }}
                        />
                      </div>

                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <div className="font-medium text-gray-900 dark:text-white">
                            {t('dashboard.submissions.onlyWhenLiveTitle', { defaultValue: 'Only while stream is live' })}
                          </div>
                          <div className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                            {t('dashboard.submissions.onlyWhenLiveHint', { defaultValue: 'If enabled, submissions will be rejected when the stream is offline.' })}
                          </div>
                        </div>
                        <ToggleSwitch
                          checked={submissionsOnlyWhenLive ?? false}
                          busy={savingSubmissionsSettings === 'onlyWhenLive'}
                          disabled={submissionsOnlyWhenLive === null || submissionsEnabled === false}
                          ariaLabel={t('dashboard.submissions.onlyWhenLiveTitle', { defaultValue: 'Only while stream is live' })}
                          onChange={(next) => {
                            setSubmissionsOnlyWhenLive(next);
                            void saveSubmissionSettings({ submissionsOnlyWhenLive: next }, 'onlyWhenLive');
                          }}
                        />
                      </div>

                      <div className="pt-4 border-t border-black/5 dark:border-white/10">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="font-medium text-gray-900 dark:text-white">
                              {t('dashboard.submissionsControl.linkTitle', { defaultValue: 'StreamerBot / StreamDeck link' })}
                            </div>
                            <div className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                              {t('dashboard.submissionsControl.linkHint', {
                                defaultValue: 'Use these links in automation tools to enable/disable submissions instantly.',
                              })}
                            </div>
                          </div>
                          <div className="flex gap-2 shrink-0">
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              disabled={loadingSubmissionsControl || rotatingSubmissionsControl}
                              onClick={() => void loadSubmissionsControlLink()}
                            >
                              {loadingSubmissionsControl
                                ? t('common.loading', { defaultValue: 'Loading…' })
                                : t('dashboard.submissionsControl.reveal', { defaultValue: 'Show link' })}
                            </Button>
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              disabled={
                                loadingSubmissionsControlStatus ||
                                !submissionsControl?.revealable ||
                                !(submissionsControl?.token || '').trim()
                              }
                              onClick={() => {
                                const token = (submissionsControl?.token || '').trim();
                                if (!token) return;
                                void refreshSubmissionsControlStatus(token);
                              }}
                            >
                              {loadingSubmissionsControlStatus
                                ? t('common.loading', { defaultValue: 'Loading…' })
                                : t('dashboard.submissionsControl.refresh', { defaultValue: 'Refresh' })}
                            </Button>
                            <Button
                              type="button"
                              variant="danger"
                              size="sm"
                              disabled={rotatingSubmissionsControl}
                              onClick={() => void rotateSubmissionsControlLink()}
                            >
                              {rotatingSubmissionsControl
                                ? t('common.loading', { defaultValue: 'Loading…' })
                                : t('dashboard.submissionsControl.rotate', { defaultValue: 'Rotate' })}
                            </Button>
                          </div>
                        </div>

                        {submissionsControl?.revealable === true && submissionsControlStatus && (
                          <div className="mt-3 flex flex-wrap items-center gap-2">
                            <Pill variant={submissionsControlStatus.enabled ? 'successSolid' : 'dangerSolid'} size="sm">
                              {t('dashboard.submissionsControl.statusSubmits', { defaultValue: 'Submits' })}:{' '}
                              {submissionsControlStatus.enabled ? t('common.on', { defaultValue: 'On' }) : t('common.off', { defaultValue: 'Off' })}
                            </Pill>
                            <Pill variant={submissionsControlStatus.onlyWhenLive ? 'neutral' : 'neutral'} size="sm">
                              {t('dashboard.submissionsControl.statusOnlyWhenLive', { defaultValue: 'Only when live' })}:{' '}
                              {submissionsControlStatus.onlyWhenLive ? t('common.on', { defaultValue: 'On' }) : t('common.off', { defaultValue: 'Off' })}
                            </Pill>
                          </div>
                        )}

                        {submissionsControl?.revealable === false && (
                          <div className="mt-3 text-sm text-gray-700 dark:text-gray-300">
                            {submissionsControl.message ||
                              t('dashboard.submissionsControl.revealOnce', { defaultValue: 'Link is hidden. Rotate to reveal a new one.' })}
                          </div>
                        )}

                        {submissionsControl?.revealable === true && submissionsControl.links && (
                          <div className="mt-4 space-y-3">
                            <SecretCopyField
                              label={t('dashboard.submissionsControl.enableLink', { defaultValue: 'Enable (idempotent)' })}
                              value={submissionsControl.links.enable}
                              masked={true}
                            />
                            <SecretCopyField
                              label={t('dashboard.submissionsControl.disableLink', { defaultValue: 'Disable (idempotent)' })}
                              value={submissionsControl.links.disable}
                              masked={true}
                            />
                            {submissionsControl.links.toggle ? (
                              <SecretCopyField
                                label={t('dashboard.submissionsControl.toggleLink', { defaultValue: 'Toggle (non-idempotent)' })}
                                value={submissionsControl.links.toggle}
                                masked={true}
                              />
                            ) : null}
                            {/* token is shown only for debugging / verification if needed */}
                            {submissionsControl.token ? (
                              <SecretCopyField
                                label={t('dashboard.submissionsControl.token', { defaultValue: 'Token (one-time)' })}
                                value={submissionsControl.token}
                                masked={false}
                              />
                            ) : null}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Bots control */}
                  <div className="surface surface-hover p-6">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <h2 className="text-lg font-semibold dark:text-white">
                          {t('dashboard.bots.title', { defaultValue: 'Bots' })}
                        </h2>
                        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                          {t('dashboard.bots.subtitle', { defaultValue: 'Enable or disable all bot integrations at once.' })}
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant={anyBotEnabled ? 'danger' : 'primary'}
                        size="sm"
                        disabled={botsLoading || !botsLoaded}
                        onClick={() => void toggleAllBots(!anyBotEnabled)}
                      >
                        {botsLoading
                          ? t('common.loading', { defaultValue: 'Loading…' })
                          : anyBotEnabled
                            ? t('dashboard.bots.disableAll', { defaultValue: 'Disable all' })
                            : t('dashboard.bots.enableAll', { defaultValue: 'Enable all' })}
                      </Button>
                    </div>

                    <div className="mt-5">
                      {!botsLoaded ? (
                        <div className="text-sm text-gray-600 dark:text-gray-400">{t('common.loading', { defaultValue: 'Loading…' })}</div>
                      ) : visibleBots.length === 0 ? (
                        <div className="text-sm text-gray-600 dark:text-gray-400">
                          {t('dashboard.bots.none', { defaultValue: 'No bot integrations found.' })}
                        </div>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {visibleBots.map((b) => (
                            <Pill key={String(b.provider)} variant={b.enabled ? 'successSolid' : 'neutral'} size="sm">
                              {String(b.provider)}: {b.enabled ? t('common.on', { defaultValue: 'On' }) : t('common.off', { defaultValue: 'Off' })}
                            </Pill>
                          ))}
                          {allBotsEnabled ? (
                            <Pill variant="success" size="sm">
                              {t('dashboard.bots.allOn', { defaultValue: 'All on' })}
                            </Pill>
                          ) : null}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

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


