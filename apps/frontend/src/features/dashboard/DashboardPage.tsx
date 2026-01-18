import { DndContext, PointerSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core';
import { arrayMove, SortableContext, useSortable, rectSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';

import type { Meme } from '@/types';

import { AllMemesPanel } from '@/components/dashboard/AllMemesPanel';
import { DashboardSubmissionsPanel } from '@/components/dashboard/DashboardSubmissionsPanel';
import Header from '@/components/Header';
import SecretCopyField from '@/components/SecretCopyField';
import { useHelpMode } from '@/contexts/HelpModeContext';
import { ApproveSubmissionModal } from '@/features/dashboard/ui/modals/ApproveSubmissionModal';
import { NeedsChangesModal, type NeedsChangesPreset } from '@/features/dashboard/ui/modals/NeedsChangesModal';
import { RejectSubmissionModal } from '@/features/dashboard/ui/modals/RejectSubmissionModal';
import { useAutoplayMemes } from '@/hooks/useAutoplayMemes';
import { useDebounce } from '@/hooks/useDebounce';
import { api } from '@/lib/api';
import { Button, IconButton, Input, PageShell, Pill, Spinner, Textarea, Tooltip } from '@/shared/ui';
import ConfirmDialog from '@/shared/ui/modals/ConfirmDialog';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import {
  approveSubmission,
  bulkModerateSubmissions,
  fetchSubmissions,
  needsChangesSubmission,
  rejectSubmission,
} from '@/store/slices/submissionsSlice';

const SubmitModal = lazy(() => import('@/components/SubmitModal'));
const MemeModal = lazy(() => import('@/components/MemeModal'));

function ChevronRightIcon() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
    </svg>
  );
}

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
type BotIntegration = { provider: string; enabled?: boolean | null };
type PublicSubmissionsStatusResponse = { ok: true; submissions: { enabled: boolean; onlyWhenLive: boolean } };

type ExpandCard = null | 'submissionsControl' | 'bots';
type DashboardCardId = 'submit' | 'mySubmissions' | 'memes' | 'settings' | 'submissionsControl' | 'bots';

const DEFAULT_DASHBOARD_ORDER: DashboardCardId[] = [
  'submit',
  'mySubmissions',
  'memes',
  'settings',
  'submissionsControl',
  'bots',
];
const DASHBOARD_CARD_IDS: readonly DashboardCardId[] = DEFAULT_DASHBOARD_ORDER;
const DASHBOARD_CARD_ID_SET = new Set<string>(DASHBOARD_CARD_IDS as unknown as string[]);

function isDashboardCardId(v: unknown): v is DashboardCardId {
  return typeof v === 'string' && DASHBOARD_CARD_ID_SET.has(v);
}

function normalizeDashboardCardOrder(input: unknown): DashboardCardId[] {
  const out: DashboardCardId[] = [];
  const seen = new Set<DashboardCardId>();
  const list = Array.isArray(input) ? input : [];
  for (const x of list) {
    if (!isDashboardCardId(x)) continue; // ignore unknown ids (forward-compat)
    if (seen.has(x)) continue;
    seen.add(x);
    out.push(x);
  }
  for (const id of DASHBOARD_CARD_IDS) {
    if (!seen.has(id)) out.push(id);
  }
  return out;
}

function DragHandleIcon() {
  return (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="9" cy="7" r="1.4" />
      <circle cx="15" cy="7" r="1.4" />
      <circle cx="9" cy="12" r="1.4" />
      <circle cx="15" cy="12" r="1.4" />
      <circle cx="9" cy="17" r="1.4" />
      <circle cx="15" cy="17" r="1.4" />
    </svg>
  );
}

function SortableCard({
  id,
  children,
  disabled,
  helpEnabled,
  dragHelpText,
}: {
  id: DashboardCardId;
  children: (opts: { dragHandle: React.ReactNode; isDragging: boolean }) => React.ReactNode;
  disabled?: boolean;
  helpEnabled?: boolean;
  dragHelpText?: string;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled: !!disabled });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.85 : undefined,
  };

  const dragHandleButton = (
    <button
      type="button"
      className="p-2 rounded-lg text-gray-500 hover:text-gray-700 dark:text-gray-300 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-grab active:cursor-grabbing"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      aria-label="Drag to reorder"
      {...attributes}
      {...listeners}
    >
      <DragHandleIcon />
    </button>
  );

  const dragHandle =
    helpEnabled && dragHelpText ? (
      <Tooltip delayMs={1000} content={dragHelpText}>
        {dragHandleButton}
      </Tooltip>
    ) : (
      dragHandleButton
    );

  return (
    <div ref={setNodeRef} style={style}>
      {children({ dragHandle, isDragging })}
    </div>
  );
}

type PendingStatusFilter = 'all' | 'pending' | 'approved' | 'rejected';
type PendingAiStatusFilter = 'all' | 'pending' | 'processing' | 'done' | 'failed';
type PendingSortOrder = 'newest-first' | 'oldest-first';
type BulkActionKind = 'approve' | 'reject' | 'needs_changes';

export default function DashboardPage() {
  const { t } = useTranslation();
  const { user, loading: authLoading } = useAppSelector((state) => state.auth);
  const {
    submissions,
    loading: submissionsLoading,
    loadingMore: submissionsLoadingMore,
    total: submissionsTotal,
    error: submissionsError,
    lastFetchedAt: submissionsLastFetchedAt,
    lastErrorAt: submissionsLastErrorAt,
  } = useAppSelector((state) => state.submissions);
  const [memesCount, setMemesCount] = useState<number | null>(null);
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [isSubmitModalOpen, setIsSubmitModalOpen] = useState(false);
  const { enabled: helpEnabled, setEnabled: setHelpEnabled } = useHelpMode();

  function CardHelpHint(props: { text: string }) {
    if (!helpEnabled) return null;
    return (
      <Tooltip delayMs={1000} content={props.text}>
        <span
          className="inline-flex items-center justify-center w-7 h-7 rounded-lg text-gray-500 dark:text-gray-300 bg-black/5 dark:bg-white/10"
          aria-label={t('dashboard.help.cardHint', { defaultValue: 'Help' })}
          role="img"
        >
          ?
        </span>
      </Tooltip>
    );
  }
  const submissionsLoadedRef = useRef(false);
  const [submissionsPanelTab, setSubmissionsPanelTab] = useState<'pending' | 'mine'>('pending');
  const [mySubmissions, setMySubmissions] = useState<import('@/features/submit/types').MySubmission[]>([]);
  const [mySubmissionsLoading, setMySubmissionsLoading] = useState(false);
  const mySubmissionsLoadedRef = useRef(false);
  const [pendingFilters, setPendingFilters] = useState<{
    status: PendingStatusFilter;
    aiStatus: PendingAiStatusFilter;
    q: string;
    sort: PendingSortOrder;
  }>({
    status: 'all',
    aiStatus: 'all',
    q: '',
    sort: 'newest-first',
  });
  const debouncedPendingQ = useDebounce(pendingFilters.q, 300);
  const pendingFiltersKeyRef = useRef('');
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
  const [approveTags, setApproveTags] = useState<string[]>([]);
  const [rejectReason, setRejectReason] = useState('');
  const [needsChangesPreset, setNeedsChangesPreset] = useState<{ badTitle: boolean; noTags: boolean; other: boolean }>({
    badTitle: false,
    noTags: false,
    other: false,
  });
  const [needsChangesText, setNeedsChangesText] = useState('');
  const [bulkModal, setBulkModal] = useState<{ open: boolean; action: BulkActionKind; submissionIds: string[] }>({
    open: false,
    action: 'approve',
    submissionIds: [],
  });
  const [bulkPriceCoins, setBulkPriceCoins] = useState('100');
  const [bulkRejectReason, setBulkRejectReason] = useState('');
  const [bulkNeedsChangesPreset, setBulkNeedsChangesPreset] = useState<NeedsChangesPreset>({
    badTitle: false,
    noTags: false,
    other: false,
  });
  const [bulkNeedsChangesText, setBulkNeedsChangesText] = useState('');
  const [bulkActionLoading, setBulkActionLoading] = useState(false);
  const [selectedMeme, setSelectedMeme] = useState<Meme | null>(null);
  const [isMemeModalOpen, setIsMemeModalOpen] = useState(false);
  const { autoplayMemesEnabled } = useAutoplayMemes();
  const submissionsPanelRef = useRef<HTMLDivElement | null>(null);
  const memesPanelRef = useRef<HTMLDivElement | null>(null);
  const [expandedCard, setExpandedCard] = useState<ExpandCard>(null);
  const [dashboardCardOrder, setDashboardCardOrder] = useState<DashboardCardId[]>(DEFAULT_DASHBOARD_ORDER);
  const saveDashboardOrderTimerRef = useRef<number | null>(null);

  const [submissionsEnabled, setSubmissionsEnabled] = useState<boolean | null>(null);
  const [submissionsOnlyWhenLive, setSubmissionsOnlyWhenLive] = useState<boolean | null>(null);
  const [savingSubmissionsSettings, setSavingSubmissionsSettings] = useState<null | 'enabled' | 'onlyWhenLive'>(null);
  const [memeCatalogMode, setMemeCatalogMode] = useState<null | 'channel' | 'pool_all'>(null);
  const [savingMemeCatalogMode, setSavingMemeCatalogMode] = useState(false);
  const [submissionsControl, setSubmissionsControl] = useState<null | { revealable: boolean; token?: string; links?: SubmissionsControlLinks; message?: string }>(
    null
  );
  const [rotatingSubmissionsControl, setRotatingSubmissionsControl] = useState(false);
  const [submissionsControlStatus, setSubmissionsControlStatus] = useState<null | { enabled: boolean; onlyWhenLive: boolean }>(null);
  const [loadingSubmissionsControlStatus, setLoadingSubmissionsControlStatus] = useState(false);

  const [bots, setBots] = useState<BotIntegration[]>([]);
  const [botsLoaded, setBotsLoaded] = useState(false);
  const [botsLoading, setBotsLoading] = useState(false);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

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

  function toRecord(v: unknown): Record<string, unknown> | null {
    if (!v || typeof v !== 'object') return null;
    if (Array.isArray(v)) return null;
    return v as Record<string, unknown>;
  }

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
      const SUBMISSIONS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
      const ERROR_RETRY_DELAY = 5 * 60 * 1000; // 5 minutes before retrying after error
      const trimmedQ = debouncedPendingQ.trim();
      const nextFiltersKey = [pendingFilters.status, pendingFilters.aiStatus, trimmedQ, pendingFilters.sort].join('|');
      const filtersChanged = pendingFiltersKeyRef.current !== nextFiltersKey;
      if (filtersChanged) {
        pendingFiltersKeyRef.current = nextFiltersKey;
        submissionsLoadedRef.current = false;
      }
      
      // Check if we have fresh data based on timestamp
      const hasFreshData =
        submissions.length > 0 &&
        submissionsLastFetchedAt !== null &&
        (Date.now() - submissionsLastFetchedAt) < SUBMISSIONS_CACHE_TTL;
      
      // Check if we had a recent error (especially 403) - don't retry immediately
      const hasRecentError =
        submissionsLastErrorAt !== null &&
        (Date.now() - submissionsLastErrorAt) < ERROR_RETRY_DELAY;
      const shouldBlockForError = hasRecentError && !filtersChanged;
      
      const isLoading = submissionsLoading;
      
      // Only fetch if no fresh data, not loading, no recent error, and not already loaded
      if ((filtersChanged || !hasFreshData) && !isLoading && !shouldBlockForError && !submissionsLoadedRef.current) {
        submissionsLoadedRef.current = true;
        dispatch(
          fetchSubmissions({
            status: pendingFilters.status,
            aiStatus: pendingFilters.aiStatus,
            q: trimmedQ || undefined,
            sort: pendingFilters.sort,
            limit: 20,
            offset: 0,
            includeTotal: true,
          }),
        );
      } else if (hasFreshData && !filtersChanged) {
        submissionsLoadedRef.current = true; // Mark as loaded even if we didn't fetch
      }
    }
    // Reset ref when user changes
    if (!userId || !userChannelId) {
      submissionsLoadedRef.current = false;
      pendingFiltersKeyRef.current = '';
    }
  }, [
    user?.id,
    user?.role,
    user?.channelId,
    submissions.length,
    submissionsLastFetchedAt,
    submissionsLastErrorAt,
    submissionsLoading,
    pendingFilters.status,
    pendingFilters.aiStatus,
    pendingFilters.sort,
    debouncedPendingQ,
    dispatch,
  ]); // Use user?.id instead of user to prevent unnecessary re-runs

  const loadMySubmissions = useCallback(async () => {
    if (!user) return;
    setMySubmissionsLoading(true);
    try {
      const tryFetch = async (withParams: boolean) => {
        return await api.get<unknown>('/submissions', {
          params: withParams ? { limit: 50, offset: 0 } : undefined,
          timeout: 10000,
        });
      };

      let data: unknown;
      try {
        data = await tryFetch(true);
      } catch {
        data = await tryFetch(false);
      }

      const normalized = Array.isArray(data)
        ? (data as unknown[]).map((raw) => {
            const s = toRecord(raw);
            const submitter = toRecord(s?.submitter);
            const tags = Array.isArray(s?.tags) ? (s?.tags as unknown[]) : [];
            const tagNames = tags
              .map((x) => {
                const xr = toRecord(x);
                const tag = toRecord(xr?.tag);
                return typeof tag?.name === 'string' ? tag.name : '';
              })
              .filter(Boolean);
            return {
              id: String(s?.id ?? ''),
              title: String(s?.title ?? ''),
              status: String(s?.status ?? ''),
              sourceKind:
                s?.sourceKind === 'upload' || s?.sourceKind === 'url' || s?.sourceKind === 'pool'
                  ? (s.sourceKind as 'upload' | 'url' | 'pool')
                  : undefined,
              memeAssetId: typeof s?.memeAssetId === 'string' ? (s.memeAssetId as string) : s?.memeAssetId === null ? null : undefined,
              createdAt: String(s?.createdAt ?? new Date().toISOString()),
              notes: typeof s?.notes === 'string' ? s.notes : s?.notes === null ? null : null,
              moderatorNotes: typeof s?.moderatorNotes === 'string' ? s.moderatorNotes : s?.moderatorNotes === null ? null : null,
              revision: typeof s?.revision === 'number' ? s.revision : 0,
              tags: tagNames,
              submitterId:
                typeof submitter?.id === 'string' ? submitter.id : typeof s?.submitterId === 'string' ? (s.submitterId as string) : null,
              submitterDisplayName:
                typeof submitter?.displayName === 'string'
                  ? submitter.displayName
                  : typeof s?.submitterDisplayName === 'string'
                    ? (s.submitterDisplayName as string)
                    : null,
            } as import('@/features/submit/types').MySubmission;
          })
        : [];

      const filtered =
        user?.id && normalized.some((x) => x.submitterId)
          ? normalized.filter((x) => x.submitterId === user.id)
          : normalized;

      const sorted = [...filtered].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      setMySubmissions(sorted);
    } catch {
      setMySubmissions([]);
    } finally {
      setMySubmissionsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    // Reset viewer-side cache when user changes (logout/login).
    mySubmissionsLoadedRef.current = false;
    setMySubmissions([]);
  }, [user?.id]);

  useEffect(() => {
    // Lazy-load "my submissions" only when user opens the dashboard submissions panel and selects the tab.
    if (panel !== 'submissions') return;
    if (submissionsPanelTab !== 'mine') return;
    if (mySubmissionsLoadedRef.current) return;
    mySubmissionsLoadedRef.current = true;
    void loadMySubmissions();
  }, [loadMySubmissions, panel, submissionsPanelTab]);

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
          memeCatalogMode?: 'channel' | 'pool_all' | null;
          dashboardCardOrder?: string[] | null;
        }>(`/channels/${slug}`, {
          // Avoid stale cached channel settings after a recent PATCH (CDN/proxy/browser caches).
          params: { includeMemes: false, _ts: Date.now() },
          headers: { 'Cache-Control': 'no-store' },
        });
        const count = data?.stats?.memesCount;
        if (typeof count === 'number') setMemesCount(count);
        if (typeof data?.submissionsEnabled === 'boolean') setSubmissionsEnabled(data.submissionsEnabled);
        if (typeof data?.submissionsOnlyWhenLive === 'boolean') setSubmissionsOnlyWhenLive(data.submissionsOnlyWhenLive);
        if (data?.memeCatalogMode === 'pool_all' || data?.memeCatalogMode === 'channel') setMemeCatalogMode(data.memeCatalogMode);
        else setMemeCatalogMode('channel');
        if (data?.dashboardCardOrder === null) {
          setDashboardCardOrder(DEFAULT_DASHBOARD_ORDER);
        } else if (Array.isArray(data?.dashboardCardOrder)) {
          const serverOrder = normalizeDashboardCardOrder(data.dashboardCardOrder);
          setDashboardCardOrder(serverOrder);
        }
      } catch {
        // ignore
      }
    })();
  }, [user?.channel?.slug]);

  const saveDashboardOrder = useCallback(
    (nextOrder: DashboardCardId[]) => {
      if (!user?.channelId) return;
      if (saveDashboardOrderTimerRef.current) window.clearTimeout(saveDashboardOrderTimerRef.current);
      saveDashboardOrderTimerRef.current = window.setTimeout(() => {
        void (async () => {
          try {
            await api.patch('/streamer/channel/settings', { dashboardCardOrder: nextOrder });
          } catch (error: unknown) {
            const apiError = error as { response?: { data?: { error?: string } } };
            toast.error(apiError.response?.data?.error || t('admin.failedToSaveSettings', { defaultValue: 'Failed to save settings' }));
          }
        })();
      }, 450);
    },
    [t, user?.channelId]
  );

  const resetDashboardOrder = useCallback(async () => {
    if (!user?.channelId) return;
    if (saveDashboardOrderTimerRef.current) window.clearTimeout(saveDashboardOrderTimerRef.current);
    saveDashboardOrderTimerRef.current = null;
    try {
      await api.patch('/streamer/channel/settings', { dashboardCardOrder: null });
      setDashboardCardOrder(DEFAULT_DASHBOARD_ORDER);
      setExpandedCard(null);
      toast.success(t('dashboard.layoutReset', { defaultValue: 'Layout reset.' }));
    } catch (error: unknown) {
      const apiError = error as { response?: { data?: { error?: string } } };
      toast.error(apiError.response?.data?.error || t('admin.failedToSaveSettings', { defaultValue: 'Failed to save settings' }));
    }
  }, [t, user?.channelId]);

  useEffect(() => {
    return () => {
      if (saveDashboardOrderTimerRef.current) window.clearTimeout(saveDashboardOrderTimerRef.current);
      saveDashboardOrderTimerRef.current = null;
    };
  }, []);

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
              params: { includeMemes: false, _ts: Date.now() },
              headers: { 'Cache-Control': 'no-store' },
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

  const saveMemeCatalogMode = useCallback(
    async (nextMode: 'channel' | 'pool_all') => {
      if (!user?.channelId) return;
      if (savingMemeCatalogMode) return;
      const prev = memeCatalogMode;
      try {
        setSavingMemeCatalogMode(true);
        const resp = await api.patch<{ memeCatalogMode?: 'channel' | 'pool_all' }>(
          '/streamer/channel/settings',
          { memeCatalogMode: nextMode },
        );
        if (resp?.memeCatalogMode === 'channel' || resp?.memeCatalogMode === 'pool_all') {
          setMemeCatalogMode(resp.memeCatalogMode);
          toast.success(t('dashboard.memeCatalogMode.saved', { defaultValue: 'Saved' }));
          return;
        }

        // Back-compat: some environments return `{ ok: true }` or omit the field.
        // Keep optimistic value and report success; next page load will reflect canonical server state.
        toast.success(t('dashboard.memeCatalogMode.saved', { defaultValue: 'Saved' }));
      } catch (error: unknown) {
        const apiError = error as { response?: { data?: { error?: string } } };
        toast.error(apiError.response?.data?.error || t('admin.failedToSaveSettings', { defaultValue: 'Failed to save settings' }));
        if (prev === 'channel' || prev === 'pool_all') setMemeCatalogMode(prev);
        // Re-fetch best-effort to resync.
        try {
          const slug = user?.channel?.slug;
          if (slug) {
            const data = await api.get<{ memeCatalogMode?: 'channel' | 'pool_all' }>(`/channels/${slug}`, {
              params: { includeMemes: false, _ts: Date.now() },
              headers: { 'Cache-Control': 'no-store' },
            });
            if (data?.memeCatalogMode === 'channel' || data?.memeCatalogMode === 'pool_all') setMemeCatalogMode(data.memeCatalogMode);
          }
        } catch {
          // ignore
        }
      } finally {
        setSavingMemeCatalogMode(false);
      }
    },
    [memeCatalogMode, savingMemeCatalogMode, t, user?.channel?.slug, user?.channelId],
  );

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
        toast.success(t('dashboard.submissionsControl.rotated', { defaultValue: 'Link generated. Save it — it cannot be shown again.' }));
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
    pendingFilters.status === 'pending' && typeof submissionsTotal === 'number'
      ? submissionsTotal
      : submissions.filter((s) => s.status === 'pending').length;

  const myChannelMemesCount = memesCount ?? 0;
  const isStreamerAdmin = user?.role === 'streamer' || user?.role === 'admin';
  const effectiveCardOrder: DashboardCardId[] = isStreamerAdmin
    ? dashboardCardOrder
    : (['submit', 'mySubmissions', 'memes', 'settings'] as DashboardCardId[]);

  const onDragEnd = useCallback(
    (event: { active: { id: unknown }; over: { id: unknown } | null }) => {
      if (!isStreamerAdmin) return;
      if (!event.over) return;
      const activeRaw = event.active?.id;
      const overRaw = event.over?.id;
      if (!isDashboardCardId(activeRaw) || !isDashboardCardId(overRaw)) return; // forward-compat
      const activeId = activeRaw;
      const overId = overRaw;
      if (!activeId || !overId) return;
      if (activeId === overId) return;
      setExpandedCard(null);
      setDashboardCardOrder((prev) => {
        const oldIndex = prev.indexOf(activeId);
        const newIndex = prev.indexOf(overId);
        if (oldIndex === -1 || newIndex === -1) return prev;
        const next = arrayMove(prev, oldIndex, newIndex) as DashboardCardId[];
        saveDashboardOrder(next);
        return next;
      });
    },
    [isStreamerAdmin, saveDashboardOrder]
  );

  const buildNeedsChangesPayload = (preset: NeedsChangesPreset, message: string) => {
    const codes: string[] = [];
    if (preset.badTitle) codes.push('bad_title');
    if (preset.noTags) codes.push('no_tags');
    if (preset.other) codes.push('other');
    const msg = message.trim();
    const hasReason = codes.length > 0 || msg.length > 0;
    const otherNeedsText = preset.other && msg.length === 0;
    const packed = JSON.stringify({ v: 1, codes, message: msg });
    return { codes, message: msg, hasReason, otherNeedsText, packed };
  };

  const openBulkModalFor = (action: BulkActionKind, submissionIds: string[]) => {
    const uniqueIds = Array.from(new Set(submissionIds));
    if (uniqueIds.length === 0) return;
    setBulkModal({ open: true, action, submissionIds: uniqueIds });
    setBulkActionLoading(false);
    setBulkPriceCoins(priceCoins);
    setBulkRejectReason('');
    setBulkNeedsChangesPreset({ badTitle: false, noTags: false, other: false });
    setBulkNeedsChangesText('');
  };

  const handleBulkConfirm = async () => {
    if (!bulkModal.open || bulkActionLoading) return;
    const submissionIds = bulkModal.submissionIds.filter(Boolean);
    if (submissionIds.length === 0) return;

    if (bulkModal.action === 'approve') {
      const parsed = parseInt(bulkPriceCoins, 10);
      if (Number.isNaN(parsed) || parsed < 1) {
        toast.error(t('admin.invalidPrice', { defaultValue: 'Price must be at least 1 coin' }));
        return;
      }
    }

    if (bulkModal.action === 'needs_changes') {
      const { hasReason, otherNeedsText } = buildNeedsChangesPayload(bulkNeedsChangesPreset, bulkNeedsChangesText);
      if (!hasReason || otherNeedsText) {
        toast.error(
          t('submissions.needsChangesReasonRequired', {
            defaultValue: 'Select a reason or write a message.',
          }),
        );
        return;
      }
    }

    setBulkActionLoading(true);
    try {
      const payload: {
        submissionIds: string[];
        action: BulkActionKind;
        moderatorNotes?: string;
        priceCoins?: number;
      } = {
        submissionIds,
        action: bulkModal.action,
      };

      if (bulkModal.action === 'approve') {
        payload.priceCoins = parseInt(bulkPriceCoins, 10);
      } else if (bulkModal.action === 'needs_changes') {
        payload.moderatorNotes = buildNeedsChangesPayload(bulkNeedsChangesPreset, bulkNeedsChangesText).packed;
      } else if (bulkModal.action === 'reject') {
        const notes = bulkRejectReason.trim();
        if (notes) payload.moderatorNotes = notes;
      }

      const result = await dispatch(bulkModerateSubmissions(payload)).unwrap();
      const successCount = Array.isArray(result?.success) ? result.success.length : 0;
      const failedCount = Array.isArray(result?.failed) ? result.failed.length : 0;

      if (successCount > 0) {
        toast.success(
          t('dashboard.bulk.successToast', {
            defaultValue: 'Bulk action complete: {{success}} succeeded.',
            success: successCount,
          }),
        );
      }
      if (failedCount > 0) {
        toast.error(
          t('dashboard.bulk.failedToast', {
            defaultValue: 'Some items failed: {{failed}}.',
            failed: failedCount,
          }),
        );
      }

      setBulkModal({ open: false, action: bulkModal.action, submissionIds: [] });
      dispatch(
        fetchSubmissions({
          status: pendingFilters.status,
          aiStatus: pendingFilters.aiStatus,
          q: debouncedPendingQ.trim() || undefined,
          sort: pendingFilters.sort,
          limit: 20,
          offset: 0,
          includeTotal: true,
        }),
      );
    } catch {
      toast.error(t('dashboard.bulk.failedAllToast', { defaultValue: 'Failed to apply bulk action.' }));
    } finally {
      setBulkActionLoading(false);
    }
  };

  const handleApprove = async () => {
    if (!approveModal.submissionId) return;
    const parsed = parseInt(priceCoins, 10);
    if (Number.isNaN(parsed) || parsed < 1) {
      toast.error(t('admin.invalidPrice', { defaultValue: 'Price must be at least 1 coin' }));
      return;
    }
    try {
      await dispatch(
        approveSubmission({
          submissionId: approveModal.submissionId,
          priceCoins: parsed,
          tags: approveTags.length > 0 ? approveTags : undefined,
        }),
      ).unwrap();
      toast.success(t('admin.approve', { defaultValue: 'Approve' }));
      setApproveModal({ open: false, submissionId: null });
      setApproveTags([]);
      dispatch(
        fetchSubmissions({
          status: pendingFilters.status,
          aiStatus: pendingFilters.aiStatus,
          q: debouncedPendingQ.trim() || undefined,
          sort: pendingFilters.sort,
          limit: 20,
          offset: 0,
          includeTotal: true,
        }),
      );
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
      dispatch(
        fetchSubmissions({
          status: pendingFilters.status,
          aiStatus: pendingFilters.aiStatus,
          q: debouncedPendingQ.trim() || undefined,
          sort: pendingFilters.sort,
          limit: 20,
          offset: 0,
          includeTotal: true,
        }),
      );
    } catch {
      toast.error(t('admin.failedToReject', { defaultValue: 'Failed to reject submission' }));
    }
  };

  const handleNeedsChanges = async () => {
    if (!needsChangesModal.submissionId) return;
    const { hasReason, otherNeedsText, packed } = buildNeedsChangesPayload(needsChangesPreset, needsChangesText);
    if (!hasReason || otherNeedsText) {
      toast.error(
        t('submissions.needsChangesReasonRequired', {
          defaultValue: 'Select a reason or write a message.',
        }),
      );
      return;
    }
    try {
      await dispatch(
        needsChangesSubmission({
          submissionId: needsChangesModal.submissionId,
          moderatorNotes: packed,
        }),
      ).unwrap();
      toast.success(t('submissions.sentForChanges', { defaultValue: 'Sent for changes.' }));
      setNeedsChangesModal({ open: false, submissionId: null });
      dispatch(
        fetchSubmissions({
          status: pendingFilters.status,
          aiStatus: pendingFilters.aiStatus,
          q: debouncedPendingQ.trim() || undefined,
          sort: pendingFilters.sort,
          limit: 20,
          offset: 0,
          includeTotal: true,
        }),
      );
    } catch {
      toast.error(t('submissions.failedToSendForChanges', { defaultValue: 'Failed to send for changes.' }));
    }
  };

  const needsChangesRemainingResubmits = (() => {
    const s = submissions.find((x) => x.id === needsChangesModal.submissionId);
    const revision = Math.max(0, Math.min(2, Number(s?.revision ?? 0) || 0));
    return Math.max(0, 2 - revision);
  })();
  const bulkCount = bulkModal.submissionIds.length;
  const bulkCheckboxBase =
    'h-4 w-4 rounded border-black/10 dark:border-white/15 bg-white/50 dark:bg-white/10 text-primary focus:ring-2 focus:ring-primary/30';

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
          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 className="text-3xl font-bold mb-2 dark:text-white">{t('dashboard.title', 'Dashboard')}</h1>
              <p className="text-gray-600 dark:text-gray-400">
                {t('dashboard.subtitle', 'Manage your memes and channel settings')}
              </p>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <IconButton
                type="button"
                variant={helpEnabled ? 'primary' : 'secondary'}
                aria-label={t('dashboard.help.toggle', { defaultValue: 'Help tooltips' })}
                onClick={() => {
                  const next = !helpEnabled;
                  setHelpEnabled(next);
                    toast.success(
                      next
                        ? t('dashboard.help.enabledToast', { defaultValue: 'Help: ON' })
                        : t('dashboard.help.disabledToast', { defaultValue: 'Help: OFF' }),
                    );
                }}
                icon={
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M8.25 9a3.75 3.75 0 017.5 0c0 2.25-2.25 2.25-2.25 4.125M12 17.25h.008M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                }
              />
            </div>
          </div>

          {user.channelId ? (
            <>
              {/* Quick Actions Cards */}
              {isStreamerAdmin && (
                <div className="flex items-center justify-end mb-3">
                  {helpEnabled ? (
                    <Tooltip delayMs={1000} content={t('dashboard.help.resetLayout', { defaultValue: 'Reset the order of dashboard cards back to the default.' })}>
                      <IconButton
                        type="button"
                        variant="secondary"
                        onClick={() => void resetDashboardOrder()}
                        aria-label={t('dashboard.resetLayout', { defaultValue: 'Reset layout' })}
                        icon={
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v6h6M20 20v-6h-6M20 9A8 8 0 006.34 6.34M4 15a8 8 0 0013.66 2.66" />
                          </svg>
                        }
                      />
                    </Tooltip>
                  ) : (
                    <IconButton
                      type="button"
                      variant="secondary"
                      onClick={() => void resetDashboardOrder()}
                      aria-label={t('dashboard.resetLayout', { defaultValue: 'Reset layout' })}
                      icon={
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v6h6M20 20v-6h-6M20 9A8 8 0 006.34 6.34M4 15a8 8 0 0013.66 2.66" />
                        </svg>
                      }
                    />
                  )}
                </div>
              )}
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
                <SortableContext items={effectiveCardOrder} strategy={rectSortingStrategy}>
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                    {effectiveCardOrder.map((cardId) => (
                      <SortableCard
                        key={cardId}
                        id={cardId}
                        disabled={!isStreamerAdmin}
                        helpEnabled={helpEnabled}
                        dragHelpText={t('dashboard.help.dragToReorder', { defaultValue: 'Drag this handle to change the order of cards on your dashboard.' })}
                      >
                        {({ dragHandle }) => {
                          const baseCardCls =
                            'surface surface-hover p-6 flex flex-col min-h-[210px] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded-2xl';

                          if (cardId === 'submit') {
                            return (
                              <div
                                className={baseCardCls}
                                role="button"
                                tabIndex={0}
                                onClick={() => setIsSubmitModalOpen(true)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    setIsSubmitModalOpen(true);
                                  }
                                }}
                                aria-label={t('dashboard.quickActions.submitMemeButton', 'Submit Meme')}
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <h2 className="text-lg font-semibold mb-2 dark:text-white">
                                    {t('dashboard.quickActions.submitMeme', 'Submit Meme')}
                                  </h2>
                                  <div className="flex items-start gap-2">
                                    <CardHelpHint
                                      text={t('dashboard.help.cards.submit', {
                                        defaultValue: 'Add a new meme to your channel (upload or import).',
                                      })}
                                    />
                                    {isStreamerAdmin ? dragHandle : null}
                                  </div>
                                </div>
                                <p className="text-gray-600 dark:text-gray-400 text-sm mb-4">
                                  {t('dashboard.quickActions.submitMemeDescription', 'Add a meme directly to your pool')}
                                </p>
                                <div className="mt-auto flex items-center justify-between text-primary font-semibold">
                                  <span>{t('dashboard.quickActions.submitMemeButton', 'Submit Meme')}</span>
                                  <ChevronRightIcon />
                                </div>
                              </div>
                            );
                          }

                          if (cardId === 'mySubmissions') {
                            return (
                              <div
                                className={baseCardCls}
                                role="button"
                                tabIndex={0}
                                onClick={() => {
                                  // Open inside dashboard: same submissions panel, but different tab.
                                  setSubmissionsPanelTab('mine');
                                  if (panel !== 'submissions') scrollToPanelIfMobile('submissions');
                                  setPanel('submissions');
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    setSubmissionsPanelTab('mine');
                                    if (panel !== 'submissions') scrollToPanelIfMobile('submissions');
                                    setPanel('submissions');
                                  }
                                }}
                                aria-label={t('dashboard.quickActions.mySubmissions', { defaultValue: 'My submissions' })}
                              >
                                <div className="flex items-start justify-between gap-3 mb-2">
                                  <div className="flex items-center gap-2 min-w-0">
                                    <h2 className="text-lg font-semibold dark:text-white truncate">
                                      {t('dashboard.quickActions.mySubmissions', { defaultValue: 'My submissions' })}
                                    </h2>
                                    {pendingSubmissionsCount > 0 && (
                                      helpEnabled ? (
                                        <Tooltip
                                          delayMs={1000}
                                          content={t('dashboard.help.pendingCount', { defaultValue: 'How many submissions are waiting for approval.' })}
                                        >
                                          <Pill variant="danger" size="md">
                                            {pendingSubmissionsCount}
                                          </Pill>
                                        </Tooltip>
                                      ) : (
                                        <Pill variant="danger" size="md">
                                          {pendingSubmissionsCount}
                                        </Pill>
                                      )
                                    )}
                                  </div>
                                  <div className="flex items-start gap-2">
                                    <CardHelpHint
                                      text={t('dashboard.help.cards.mySubmissions', {
                                        defaultValue: 'Open your submission list and see what needs your action.',
                                      })}
                                    />
                                    {isStreamerAdmin ? dragHandle : null}
                                  </div>
                                </div>
                                <p className="text-gray-600 dark:text-gray-400 text-sm mb-4">
                                  {t('dashboard.quickActions.mySubmissionsDescription', {
                                    defaultValue: 'Track the submissions you sent to other channels',
                                  })}
                                </p>
                                <div className="mt-auto flex items-center justify-between text-primary font-semibold">
                                  <span>{t('dashboard.quickActions.mySubmissionsButton', { defaultValue: 'Open' })}</span>
                                  <ChevronRightIcon />
                                </div>
                              </div>
                            );
                          }

                          if (cardId === 'memes') {
                            return (
                              <div
                                className={baseCardCls}
                                role="button"
                                tabIndex={0}
                                onClick={() => {
                                  const next = panel === 'memes' ? null : 'memes';
                                  if (next) scrollToPanelIfMobile('memes');
                                  setPanel(next);
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    const next = panel === 'memes' ? null : 'memes';
                                    if (next) scrollToPanelIfMobile('memes');
                                    setPanel(next);
                                  }
                                }}
                                aria-label={t('dashboard.quickActions.allMemes', { defaultValue: 'All memes' })}
                              >
                                <div className="flex items-start justify-between gap-3 mb-2">
                                  <div className="flex items-center justify-between w-full gap-3">
                                    <h2 className="text-lg font-semibold dark:text-white">
                                      {t('dashboard.quickActions.allMemes', { defaultValue: 'All memes' })}
                                    </h2>
                                    <span className="text-xs text-gray-500 dark:text-gray-400">
                                      {memesCount === null ? '…' : myChannelMemesCount}
                                    </span>
                                  </div>
                                  <div className="flex items-start gap-2">
                                    <CardHelpHint
                                      text={t('dashboard.help.cards.allMemes', {
                                        defaultValue: 'Browse your meme library and edit existing memes.',
                                      })}
                                    />
                                    {isStreamerAdmin ? dragHandle : null}
                                  </div>
                                </div>
                                <p className="text-gray-600 dark:text-gray-400 text-sm mb-4">
                                  {t('dashboard.quickActions.allMemesDescription', { defaultValue: 'Browse and edit your meme library' })}
                                </p>
                                <div className="mt-auto flex items-center justify-between text-primary font-semibold">
                                  <span>
                                    {panel === 'memes'
                                      ? t('common.close', { defaultValue: 'Close' })
                                      : t('dashboard.quickActions.openAllMemes', { defaultValue: 'Open' })}
                                  </span>
                                  <ChevronRightIcon />
                                </div>
                              </div>
                            );
                          }

                          if (cardId === 'settings') {
                            return (
                              <div
                                className={baseCardCls}
                                role="button"
                                tabIndex={0}
                                onClick={() => navigate('/settings?tab=settings')}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    navigate('/settings?tab=settings');
                                  }
                                }}
                                aria-label={t('dashboard.quickActions.settingsButton', 'Open Settings')}
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <h2 className="text-lg font-semibold mb-2 dark:text-white">
                                    {t('dashboard.quickActions.settings', 'Settings')}
                                  </h2>
                                  <div className="flex items-start gap-2">
                                    <CardHelpHint
                                      text={t('dashboard.help.cards.settings', {
                                        defaultValue: 'Open channel settings: rewards, bots, OBS links, and more.',
                                      })}
                                    />
                                    {isStreamerAdmin ? dragHandle : null}
                                  </div>
                                </div>
                                <p className="text-gray-600 dark:text-gray-400 text-sm mb-4">
                                  {t('dashboard.quickActions.settingsDescription', 'Configure your channel and preferences')}
                                </p>
                                <div className="mt-auto flex items-center justify-between text-primary font-semibold">
                                  <span>{t('dashboard.quickActions.settingsButton', 'Open Settings')}</span>
                                  <ChevronRightIcon />
                                </div>
                              </div>
                            );
                          }

                          if (cardId === 'submissionsControl' && isStreamerAdmin) {
                            return (
                              <div
                                className="surface surface-hover p-6 flex flex-col min-h-[210px] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded-2xl"
                                role="button"
                                tabIndex={0}
                                aria-expanded={expandedCard === 'submissionsControl'}
                                onClick={() => setExpandedCard((v) => (v === 'submissionsControl' ? null : 'submissionsControl'))}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    setExpandedCard((v) => (v === 'submissionsControl' ? null : 'submissionsControl'));
                                  }
                                }}
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <h2 className="text-lg font-semibold dark:text-white">
                                      {t('dashboard.submissionsControl.title', { defaultValue: 'Отправка мемов' })}
                                    </h2>
                                    <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                                      {t('dashboard.submissionsControl.subtitle', {
                                        defaultValue: 'Быстро включайте/выключайте отправку и генерируйте ссылки для StreamerBot.',
                                      })}
                                    </p>
                                  </div>
                                  <div className="flex items-start gap-2 shrink-0">
                                    <CardHelpHint
                                      text={t('dashboard.help.cards.submissionsControl', {
                                        defaultValue: 'Control whether viewers can submit memes, and generate automation links.',
                                      })}
                                    />
                                    <Pill variant={submissionsEnabled === false ? 'dangerSolid' : 'successSolid'} size="sm">
                                      {t('dashboard.submissionsControl.statusSubmits', { defaultValue: 'Submits' })}:{' '}
                                      {submissionsEnabled === false ? t('common.off', { defaultValue: 'Off' }) : t('common.on', { defaultValue: 'On' })}
                                    </Pill>
                                    {dragHandle}
                                  </div>
                                </div>
                                <div className="mt-auto flex items-center justify-between text-primary font-semibold">
                                  <span>{expandedCard === 'submissionsControl' ? t('common.close', { defaultValue: 'Close' }) : t('common.open', { defaultValue: 'Open' })}</span>
                                  <ChevronRightIcon />
                                </div>
                              </div>
                            );
                          }

                          if (cardId === 'bots' && isStreamerAdmin) {
                            return (
                              <div
                                className="surface surface-hover p-6 flex flex-col min-h-[210px] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded-2xl"
                                role="button"
                                tabIndex={0}
                                aria-expanded={expandedCard === 'bots'}
                                onClick={() => setExpandedCard((v) => (v === 'bots' ? null : 'bots'))}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    setExpandedCard((v) => (v === 'bots' ? null : 'bots'));
                                  }
                                }}
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <h2 className="text-lg font-semibold dark:text-white">{t('dashboard.bots.title', { defaultValue: 'Боты' })}</h2>
                                    <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                                      {t('dashboard.bots.subtitle', { defaultValue: 'Включайте или выключайте все интеграции одним действием.' })}
                                    </p>
                                  </div>
                                  <div className="flex items-start gap-2 shrink-0">
                                    <CardHelpHint
                                      text={t('dashboard.help.cards.bots', {
                                        defaultValue: 'Manage bot integrations: enable/disable them quickly.',
                                      })}
                                    />
                                    <Pill variant={anyBotEnabled ? 'successSolid' : 'neutral'} size="sm">
                                      {anyBotEnabled ? t('common.on', { defaultValue: 'On' }) : t('common.off', { defaultValue: 'Off' })}
                                    </Pill>
                                    {dragHandle}
                                  </div>
                                </div>
                                <div className="mt-auto flex items-center justify-between text-primary font-semibold">
                                  <span>{expandedCard === 'bots' ? t('common.close', { defaultValue: 'Close' }) : t('common.open', { defaultValue: 'Open' })}</span>
                                  <ChevronRightIcon />
                                </div>
                              </div>
                            );
                          }

                          return (
                            <div className="surface surface-hover p-6 flex flex-col min-h-[210px] rounded-2xl">
                              <div className="text-sm text-gray-600 dark:text-gray-400">Unknown card</div>
                            </div>
                          );
                        }}
                      </SortableCard>
                    ))}
                  </div>
                </SortableContext>
              </DndContext>

              {/* Expanded panel renders OUTSIDE the grid so the grid stays compact (cards 5/6 swap positions naturally). */}
              {(user.role === 'streamer' || user.role === 'admin') && (
                <div
                  className={[
                    'overflow-hidden transition-all duration-300',
                    expandedCard ? 'max-h-[1400px] opacity-100 mt-6' : 'max-h-0 opacity-0 mt-0',
                  ].join(' ')}
                >
                  {expandedCard === 'submissionsControl' ? (
                    <div className="surface p-6">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <h2 className="text-xl font-bold dark:text-white">
                            {t('dashboard.submissionsControl.title', { defaultValue: 'Отправка мемов' })}
                          </h2>
                          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                            {t('dashboard.submissionsControl.subtitle', { defaultValue: 'Быстро включайте/выключайте отправку и генерируйте ссылки для StreamerBot.' })}
                          </p>
                        </div>
                        <Button type="button" variant="secondary" size="sm" onClick={() => setExpandedCard(null)}>
                          {t('common.close', { defaultValue: 'Close' })}
                        </Button>
                      </div>

                      <div className="mt-5 space-y-4">
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0">
                            <div className="font-medium text-gray-900 dark:text-white">
                              {t('dashboard.submissions.enabledTitle', { defaultValue: 'Разрешить отправку' })}
                            </div>
                            <div className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                              {t('dashboard.submissions.enabledHint', { defaultValue: 'Если выключено — зритель увидит сообщение вместо формы.' })}
                            </div>
                          </div>
                          <ToggleSwitch
                            checked={submissionsEnabled ?? true}
                            busy={savingSubmissionsSettings === 'enabled'}
                            disabled={submissionsEnabled === null}
                            ariaLabel={t('dashboard.submissions.enabledTitle', { defaultValue: 'Разрешить отправку' })}
                            onChange={(next) => {
                              setSubmissionsEnabled(next);
                              void saveSubmissionSettings({ submissionsEnabled: next }, 'enabled');
                            }}
                          />
                        </div>

                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0">
                            <div className="font-medium text-gray-900 dark:text-white">
                              {t('dashboard.submissions.onlyWhenLiveTitle', { defaultValue: 'Только когда стрим онлайн' })}
                            </div>
                            <div className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                              {t('dashboard.submissions.onlyWhenLiveHint', { defaultValue: 'Если включено — отправка недоступна когда стрим оффлайн.' })}
                            </div>
                          </div>
                          <ToggleSwitch
                            checked={submissionsOnlyWhenLive ?? false}
                            busy={savingSubmissionsSettings === 'onlyWhenLive'}
                            disabled={submissionsOnlyWhenLive === null || submissionsEnabled === false}
                            ariaLabel={t('dashboard.submissions.onlyWhenLiveTitle', { defaultValue: 'Только когда стрим онлайн' })}
                            onChange={(next) => {
                              setSubmissionsOnlyWhenLive(next);
                              void saveSubmissionSettings({ submissionsOnlyWhenLive: next }, 'onlyWhenLive');
                            }}
                          />
                        </div>

                        <div className="pt-4 border-t border-black/5 dark:border-white/10">
                          <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0">
                              <div className="font-medium text-gray-900 dark:text-white">
                                {t('dashboard.memeCatalogMode.title', { defaultValue: 'Каталог мемов на публичной странице' })}
                              </div>
                              <div className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                                {t('dashboard.memeCatalogMode.hint', {
                                  defaultValue:
                                    'Выберите, что будет показываться на странице канала: только ваши одобренные мемы или весь пул.',
                                })}
                              </div>
                            </div>
                            <ToggleSwitch
                              checked={memeCatalogMode === 'pool_all'}
                              busy={savingMemeCatalogMode}
                              disabled={memeCatalogMode === null}
                              ariaLabel={t('dashboard.memeCatalogMode.toggleAria', { defaultValue: 'Show all pool memes on channel page' })}
                              onChange={(next) => {
                                const nextMode = next ? 'pool_all' : 'channel';
                                setMemeCatalogMode(nextMode);
                                void saveMemeCatalogMode(nextMode);
                              }}
                            />
                          </div>
                          <div className="mt-2 text-xs text-gray-600 dark:text-gray-400">
                            {memeCatalogMode === 'pool_all'
                              ? t('dashboard.memeCatalogMode.state.poolAll', { defaultValue: 'Сейчас: весь пул (пользователи могут активировать любой мем).' })
                              : t('dashboard.memeCatalogMode.state.channelOnly', { defaultValue: 'Сейчас: только мои одобренные мемы.' })}
                          </div>
                        </div>

                        <div className="pt-4 border-t border-black/5 dark:border-white/10">
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <div className="font-medium text-gray-900 dark:text-white">
                                {t('dashboard.submissionsControl.linkTitle', { defaultValue: 'Ссылки для StreamerBot / StreamDeck' })}
                              </div>
                              <div className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                                {t('dashboard.submissionsControl.linkHint', {
                                  defaultValue:
                                    'Нажмите «Сгенерировать» и сохраните ссылки. Посмотреть их повторно будет нельзя — только перегенерировать.',
                                })}
                              </div>
                            </div>
                            <Button
                              type="button"
                              variant="danger"
                              size="sm"
                              disabled={rotatingSubmissionsControl}
                              onClick={() => void rotateSubmissionsControlLink()}
                            >
                              {rotatingSubmissionsControl
                                ? t('common.loading', { defaultValue: 'Loading…' })
                                : t('dashboard.submissionsControl.rotate', { defaultValue: 'Сгенерировать' })}
                            </Button>
                          </div>

                          {submissionsControl?.revealable === true && submissionsControlStatus && (
                            <div className="mt-3 flex flex-wrap items-center gap-2">
                              <Pill variant={submissionsControlStatus.enabled ? 'successSolid' : 'dangerSolid'} size="sm">
                                {t('dashboard.submissionsControl.statusSubmits', { defaultValue: 'Submits' })}:{' '}
                                {submissionsControlStatus.enabled ? t('common.on', { defaultValue: 'On' }) : t('common.off', { defaultValue: 'Off' })}
                              </Pill>
                              <Pill variant="neutral" size="sm">
                                {t('dashboard.submissionsControl.statusOnlyWhenLive', { defaultValue: 'Only when live' })}:{' '}
                                {submissionsControlStatus.onlyWhenLive ? t('common.on', { defaultValue: 'On' }) : t('common.off', { defaultValue: 'Off' })}
                              </Pill>
                            </div>
                          )}

                          {submissionsControl?.revealable === true && submissionsControl.links && (
                            <div className="mt-4 space-y-3">
                              <SecretCopyField
                                label={t('dashboard.submissionsControl.enableLink', { defaultValue: 'Ссылка включения' })}
                                value={submissionsControl.links.enable}
                                masked={true}
                                helpEnabled={helpEnabled}
                              />
                              <SecretCopyField
                                label={t('dashboard.submissionsControl.disableLink', { defaultValue: 'Ссылка выключения' })}
                                value={submissionsControl.links.disable}
                                masked={true}
                                helpEnabled={helpEnabled}
                              />
                              {submissionsControl.links.toggle ? (
                                <SecretCopyField
                                  label={t('dashboard.submissionsControl.toggleLink', { defaultValue: 'Ссылка переключения (вкл/выкл)' })}
                                  value={submissionsControl.links.toggle}
                                  masked={true}
                                  helpEnabled={helpEnabled}
                                />
                              ) : null}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ) : expandedCard === 'bots' ? (
                    <div className="surface p-6">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <h2 className="text-xl font-bold dark:text-white">{t('dashboard.bots.title', { defaultValue: 'Боты' })}</h2>
                          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                            {t('dashboard.bots.subtitle', { defaultValue: 'Включайте или выключайте все интеграции одним действием.' })}
                          </p>
                        </div>
                        <Button type="button" variant="secondary" size="sm" onClick={() => setExpandedCard(null)}>
                          {t('common.close', { defaultValue: 'Close' })}
                        </Button>
                      </div>

                      <div className="mt-5 flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <div className="font-medium text-gray-900 dark:text-white">{t('dashboard.bots.allOn', { defaultValue: 'Все провайдеры' })}</div>
                          <div className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                            {t('dashboard.bots.hint', { defaultValue: 'Список берётся с сервера. Если YouTube просит re-link — переподключите в Settings → Bot.' })}
                          </div>
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
                              ? t('dashboard.bots.disableAll', { defaultValue: 'Выключить всех' })
                              : t('dashboard.bots.enableAll', { defaultValue: 'Включить всех' })}
                        </Button>
                      </div>

                      <div className="mt-4">
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
                  ) : null}
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
                    <DashboardSubmissionsPanel
                      isOpen={panel === 'submissions'}
                      activeTab={submissionsPanelTab}
                      onTabChange={(nextTab) => {
                        setSubmissionsPanelTab(nextTab);
                        if (nextTab === 'mine') {
                          // Ensure we load as soon as user selects the tab.
                          if (!mySubmissionsLoadedRef.current) void loadMySubmissions();
                        }
                      }}
                      helpEnabled={helpEnabled}
                      submissions={submissions}
                      submissionsLoading={submissionsLoading}
                      submissionsLoadingMore={submissionsLoadingMore}
                      pendingError={submissionsError}
                      pendingCount={pendingSubmissionsCount}
                      total={submissionsTotal}
                      pendingFilters={pendingFilters}
                      onPendingFiltersChange={setPendingFilters}
                      onClose={() => setPanel(null)}
                      onLoadMorePending={() => {
                        const offset = submissions.length;
                        // If we know total and already loaded everything, skip.
                        if (typeof submissionsTotal === 'number' && offset >= submissionsTotal) return;
                        dispatch(
                          fetchSubmissions({
                            status: pendingFilters.status,
                            aiStatus: pendingFilters.aiStatus,
                            q: debouncedPendingQ.trim() || undefined,
                            sort: pendingFilters.sort,
                            limit: 20,
                            offset,
                          }),
                        );
                      }}
                      onRetryPending={() => {
                        dispatch(
                          fetchSubmissions({
                            status: pendingFilters.status,
                            aiStatus: pendingFilters.aiStatus,
                            q: debouncedPendingQ.trim() || undefined,
                            sort: pendingFilters.sort,
                            limit: 20,
                            offset: 0,
                            includeTotal: true,
                          }),
                        );
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
                      onBulkAction={(action, submissionIds) => {
                        openBulkModalFor(action, submissionIds);
                      }}
                      mySubmissions={mySubmissions}
                      mySubmissionsLoading={mySubmissionsLoading}
                      onRefreshMySubmissions={() => void loadMySubmissions()}
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
        submission={submissions.find((s) => s.id === approveModal.submissionId) || null}
        priceCoins={priceCoins}
        onPriceCoinsChange={setPriceCoins}
        tags={approveTags}
        onTagsChange={setApproveTags}
        onClose={() => {
          setApproveModal({ open: false, submissionId: null });
          setApproveTags([]);
        }}
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

      <ConfirmDialog
        isOpen={bulkModal.open}
        onClose={() => {
          if (bulkActionLoading) return;
          setBulkModal({ open: false, action: bulkModal.action, submissionIds: [] });
        }}
        onConfirm={() => void handleBulkConfirm()}
        isLoading={bulkActionLoading}
        title={
          bulkModal.action === 'approve'
            ? t('dashboard.bulk.approveTitle', { defaultValue: 'Approve {{count}} submissions', count: bulkCount })
            : bulkModal.action === 'needs_changes'
              ? t('dashboard.bulk.needsChangesTitle', { defaultValue: 'Send {{count}} submissions for changes', count: bulkCount })
              : t('dashboard.bulk.rejectTitle', { defaultValue: 'Reject {{count}} submissions', count: bulkCount })
        }
        confirmText={
          bulkModal.action === 'approve'
            ? t('admin.approve', { defaultValue: 'Approve' })
            : bulkModal.action === 'needs_changes'
              ? t('submissions.sendForChanges', { defaultValue: 'Send' })
              : t('admin.reject', { defaultValue: 'Reject' })
        }
        cancelText={t('common.cancel', { defaultValue: 'Cancel' })}
        confirmButtonClass={
          bulkModal.action === 'approve'
            ? 'bg-emerald-600 hover:bg-emerald-700'
            : bulkModal.action === 'needs_changes'
              ? 'bg-amber-500 hover:bg-amber-600'
              : 'bg-red-600 hover:bg-red-700'
        }
        message={
          bulkModal.action === 'approve' ? (
            <div className="space-y-3">
              <div className="text-sm text-gray-600 dark:text-gray-300">
                {t('dashboard.bulk.confirmHint', {
                  defaultValue: 'This will apply to {{count}} submissions.',
                  count: bulkCount,
                })}
              </div>
              <div className="space-y-1">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  {t('admin.priceCoins', { defaultValue: 'Price (coins)' })}
                </label>
                <Input
                  type="number"
                  min={1}
                  value={bulkPriceCoins}
                  onChange={(e) => setBulkPriceCoins(e.target.value)}
                  required
                  inputMode="numeric"
                />
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {t('admin.priceCoinsDescription', { defaultValue: 'Minimum 1 coin' })}
                </p>
              </div>
            </div>
          ) : bulkModal.action === 'needs_changes' ? (
            <div className="space-y-4">
              <div className="text-sm text-gray-600 dark:text-gray-300">
                {t('dashboard.bulk.confirmHint', {
                  defaultValue: 'This will apply to {{count}} submissions.',
                  count: bulkCount,
                })}
              </div>
              <div className="space-y-2">
                <div className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  {t('submissions.quickReasons', { defaultValue: 'Quick reasons' })}
                </div>
                <label className="flex items-center gap-2 text-sm text-gray-900 dark:text-gray-100 select-none">
                  <input
                    type="checkbox"
                    className={bulkCheckboxBase}
                    checked={bulkNeedsChangesPreset.badTitle}
                    onChange={(e) => setBulkNeedsChangesPreset({ ...bulkNeedsChangesPreset, badTitle: e.target.checked })}
                  />
                  {t('submissions.reasonBadTitle', { defaultValue: 'Title is not OK' })}
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-900 dark:text-gray-100 select-none">
                  <input
                    type="checkbox"
                    className={bulkCheckboxBase}
                    checked={bulkNeedsChangesPreset.noTags}
                    onChange={(e) => setBulkNeedsChangesPreset({ ...bulkNeedsChangesPreset, noTags: e.target.checked })}
                  />
                  {t('submissions.reasonNoTags', { defaultValue: 'No tags' })}
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-900 dark:text-gray-100 select-none">
                  <input
                    type="checkbox"
                    className={bulkCheckboxBase}
                    checked={bulkNeedsChangesPreset.other}
                    onChange={(e) => setBulkNeedsChangesPreset({ ...bulkNeedsChangesPreset, other: e.target.checked })}
                  />
                  {t('submissions.reasonOther', { defaultValue: 'Other (write below)' })}
                </label>
              </div>
              <div className="space-y-1">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  {t('submissions.messageToUser', { defaultValue: 'Message to user (optional)' })}
                </label>
                <Textarea
                  value={bulkNeedsChangesText}
                  onChange={(e) => setBulkNeedsChangesText(e.target.value)}
                  rows={4}
                  placeholder={t('submissions.messagePlaceholder', { defaultValue: 'Explain what to fix:' })}
                />
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {t('submissions.messageHint', { defaultValue: 'This will be shown to the submitter.' })}
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="text-sm text-gray-600 dark:text-gray-300">
                {t('dashboard.bulk.confirmHint', {
                  defaultValue: 'This will apply to {{count}} submissions.',
                  count: bulkCount,
                })}
              </div>
              <div className="space-y-1">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  {t('dashboard.bulk.rejectReasonLabel', { defaultValue: 'Reject reason (optional)' })}
                </label>
                <Textarea
                  value={bulkRejectReason}
                  onChange={(e) => setBulkRejectReason(e.target.value)}
                  rows={4}
                  placeholder={t('dashboard.bulk.rejectReasonPlaceholder', { defaultValue: 'Reason for rejection (optional)' })}
                />
              </div>
            </div>
          )
        }
      />
    </>
  );
}
