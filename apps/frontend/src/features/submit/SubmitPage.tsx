import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { ChannelSubmissionsSection } from './components/ChannelSubmissionsSection';
import { MySubmissionsSection } from './components/MySubmissionsSection';

import type { MySubmission } from './types';
import type { Submission, SubmissionStatus } from '@/types';

import Header from '@/components/Header';
import { api } from '@/lib/api';
import { focusSafely } from '@/shared/lib/a11y/focus';
import { PageShell, Pill } from '@/shared/ui';
import { useAppSelector } from '@/store/hooks';

function toRecord(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== 'object') return null;
  if (Array.isArray(v)) return null;
  return v as Record<string, unknown>;
}

export default function Submit() {
  const { t } = useTranslation();
  const { user } = useAppSelector((state) => state.auth);
  const navigate = useNavigate();
  const tabsReactId = useId();
  const tabsIdBase = `submit-tabs-${tabsReactId.replace(/:/g, '')}`;
  type SubmitTab = 'needs_changes' | 'history' | 'channel';

  const [mySubmissions, setMySubmissions] = useState<MySubmission[]>([]);
  const [loadingMySubmissions, setLoadingMySubmissions] = useState(false);

  const [activeTab, setActiveTab] = useState<SubmitTab>('history');
  const mySubmissionsRef = useRef<HTMLElement | null>(null);
  const defaultTabSetRef = useRef(false);

  // Streamer/admin "channel submissions history" (separate from Redux pending list)
  const canSeeChannelHistory = Boolean(user && (user.role === 'streamer' || user.role === 'admin') && user.channelId);
  const [channelSubmissions, setChannelSubmissions] = useState<Submission[]>([]);
  const [loadingChannelSubmissions, setLoadingChannelSubmissions] = useState(false);
  const [channelStatusFilter, setChannelStatusFilter] = useState<'all' | SubmissionStatus>('all');
  const [channelQuery, setChannelQuery] = useState('');
  const [selectedSubmitterId, setSelectedSubmitterId] = useState<string | null>(null);
  const [selectedSubmitterName, setSelectedSubmitterName] = useState<string | null>(null);

  useEffect(() => {
    if (!user) {
      navigate('/');
    }
  }, [user, navigate]);

  const loadMySubmissions = useCallback(async () => {
    if (!user) return;
    try {
      setLoadingMySubmissions(true);
      const data = await api.get<unknown>('/submissions', { timeout: 10000 });
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
            };
          })
        : [];
      // Extra safety: if backend returns submitter id, guarantee we show only the current user's submissions.
      const filtered =
        user?.id && normalized.some((x) => x.submitterId)
          ? normalized.filter((x) => x.submitterId === user.id)
          : normalized;
      setMySubmissions(filtered);
    } catch (err) {
      setMySubmissions([]);
    } finally {
      setLoadingMySubmissions(false);
    }
  }, [user]);

  useEffect(() => {
    void loadMySubmissions();
  }, [loadMySubmissions]);

  const loadChannelHistory = useCallback(async (statusOverride?: 'all' | SubmissionStatus) => {
    if (!user || !canSeeChannelHistory) return;
    const effectiveStatus = statusOverride ?? channelStatusFilter;

    const parsePage = (resp: unknown): { items: Submission[]; total: number | null } => {
      if (Array.isArray(resp)) return { items: resp as Submission[], total: resp.length };
      const r = resp && typeof resp === 'object' ? (resp as { items?: unknown; total?: unknown }) : null;
      if (Array.isArray(r?.items)) {
        const total = typeof r?.total === 'number' ? r.total : null;
        return { items: r.items as Submission[], total };
      }
      return { items: [], total: null };
    };

    try {
      setLoadingChannelSubmissions(true);

      // We don't know if backend supports `status=all`, so for "all" we fetch per-status and merge.
      const limit = 50;
      const fetchOne = async (status: SubmissionStatus) => {
        const resp = await api.get<unknown>('/streamer/submissions', {
          params: { status, limit, offset: 0, includeTotal: 0, includeTags: 0 },
          timeout: 15000,
        });
        return parsePage(resp).items;
      };

      const items =
        effectiveStatus === 'all'
          ? (await Promise.all([
              fetchOne('pending'),
              fetchOne('needs_changes'),
              fetchOne('approved'),
              fetchOne('rejected'),
            ])).flat()
          : await fetchOne(effectiveStatus);

      const dedup = new Map<string, Submission>();
      for (const s of items) dedup.set(s.id, s);

      const merged = Array.from(dedup.values()).sort((a, b) => {
        const ta = new Date(a.createdAt).getTime();
        const tb = new Date(b.createdAt).getTime();
        return tb - ta;
      });

      setChannelSubmissions(merged);
    } catch {
      setChannelSubmissions([]);
      toast.error(t('submit.failedToLoadChannelSubmissions', { defaultValue: 'Failed to load channel submissions.' }));
    } finally {
      setLoadingChannelSubmissions(false);
    }
  }, [canSeeChannelHistory, channelStatusFilter, t, user]);

  useEffect(() => {
    // Default tab: only once per page entry.
    if (defaultTabSetRef.current) return;
    if (loadingMySubmissions) return;
    defaultTabSetRef.current = true;
    const hasNeedsChanges = mySubmissions.some((s) => s.status === 'needs_changes');
    setActiveTab(hasNeedsChanges ? 'needs_changes' : 'history');
  }, [loadingMySubmissions, mySubmissions]);

  useEffect(() => {
    if (activeTab !== 'channel' || !canSeeChannelHistory) return;
    void loadChannelHistory();
  }, [activeTab, canSeeChannelHistory, loadChannelHistory]);

  const needsChanges = useMemo(
    () => mySubmissions.filter((s) => s.status === 'needs_changes'),
    [mySubmissions],
  );
  const history = useMemo(
    () => [...mySubmissions].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [mySubmissions],
  );

  if (!user) {
    return null;
  }

  const tabs: readonly SubmitTab[] = canSeeChannelHistory ? ['needs_changes', 'history', 'channel'] : ['needs_changes', 'history'];
  const getTabId = (tab: SubmitTab) => `${tabsIdBase}-tab-${tab}`;
  const getPanelId = (tab: SubmitTab) => `${tabsIdBase}-panel-${tab}`;

  const focusTabButton = (tab: SubmitTab) => {
    const el = document.getElementById(getTabId(tab));
    if (el instanceof HTMLElement) focusSafely(el);
  };

  const handleTabsKeyDown = (
    e: React.KeyboardEvent<HTMLButtonElement>,
    tab: SubmitTab,
  ) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    e.stopPropagation();

    const idx = tabs.indexOf(tab);
    if (idx === -1) return;

    let next: (typeof tabs)[number] = tab;
    if (e.key === 'Home') next = tabs[0]!;
    if (e.key === 'End') next = tabs[tabs.length - 1]!;
    if (e.key === 'ArrowRight') next = tabs[(idx + 1) % tabs.length]!;
    if (e.key === 'ArrowLeft') next = tabs[(idx - 1 + tabs.length) % tabs.length]!;

    setActiveTab(next);
    window.requestAnimationFrame(() => focusTabButton(next));
  };

  return (
    <PageShell header={<Header />} containerClassName="max-w-4xl">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold mb-2 dark:text-white">
              {t('submit.mySubmissionsTitle', { defaultValue: 'Submissions' })}
            </h1>
            <p className="text-gray-600 dark:text-gray-400">
              {t('submit.mySubmissionsSubtitle', {
                defaultValue: 'Track your submissions and quickly fix the ones that were sent back for changes.',
              })}
            </p>
          </div>
        </div>

        <div className="mt-6 surface p-2">
          <div
            className="flex flex-wrap gap-2"
            role="tablist"
            aria-label={t('submit.tabs', { defaultValue: 'Submissions tabs' })}
          >
            <button
              type="button"
              onClick={() => setActiveTab('needs_changes')}
              onKeyDown={(e) => handleTabsKeyDown(e, 'needs_changes')}
              className={`px-3 py-2 rounded-lg text-sm font-semibold transition-colors ${
                activeTab === 'needs_changes'
                  ? 'bg-primary text-white'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600'
              }`}
              id={getTabId('needs_changes')}
              role="tab"
              aria-selected={activeTab === 'needs_changes'}
              aria-controls={getPanelId('needs_changes')}
              tabIndex={activeTab === 'needs_changes' ? 0 : -1}
            >
              <span className="inline-flex items-center gap-2">
                {t('submit.needsChangesTab', { defaultValue: 'Needs changes' })}
                <Pill
                  variant={needsChanges.length > 0 ? 'warning' : 'neutral'}
                  title={t('submit.needsChangesCount', { defaultValue: '{{count}} items', count: needsChanges.length })}
                >
                  {needsChanges.length}
                </Pill>
              </span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('history')}
              onKeyDown={(e) => handleTabsKeyDown(e, 'history')}
              className={`px-3 py-2 rounded-lg text-sm font-semibold transition-colors ${
                activeTab === 'history'
                  ? 'bg-primary text-white'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600'
              }`}
              id={getTabId('history')}
              role="tab"
              aria-selected={activeTab === 'history'}
              aria-controls={getPanelId('history')}
              tabIndex={activeTab === 'history' ? 0 : -1}
            >
              <span className="inline-flex items-center gap-2">
                {t('submit.historyTab', { defaultValue: 'History' })}
                <Pill
                  variant="neutral"
                  title={t('submit.historyCount', { defaultValue: '{{count}} items', count: history.length })}
                >
                  {history.length}
                </Pill>
              </span>
            </button>

            {canSeeChannelHistory && (
              <button
                type="button"
                onClick={() => setActiveTab('channel')}
                onKeyDown={(e) => handleTabsKeyDown(e, 'channel')}
                className={`px-3 py-2 rounded-lg text-sm font-semibold transition-colors ${
                  activeTab === 'channel'
                    ? 'bg-primary text-white'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600'
                }`}
                id={getTabId('channel')}
                role="tab"
                aria-selected={activeTab === 'channel'}
                aria-controls={getPanelId('channel')}
                tabIndex={activeTab === 'channel' ? 0 : -1}
              >
                {t('submit.channelHistoryTab', { defaultValue: 'Channel submissions' })}
              </button>
            )}
          </div>
        </div>

        <div
          role="tabpanel"
          id={getPanelId('needs_changes')}
          aria-labelledby={getTabId('needs_changes')}
          hidden={activeTab !== 'needs_changes'}
        >
          {activeTab === 'needs_changes' && (
            <MySubmissionsSection
              containerRef={(el) => {
                mySubmissionsRef.current = el;
              }}
              title={t('submit.needsChangesTab', { defaultValue: 'Needs changes' })}
              mode="needs_changes"
              submissions={needsChanges}
              loading={loadingMySubmissions}
              onRefresh={loadMySubmissions}
            />
          )}
        </div>

        <div role="tabpanel" id={getPanelId('history')} aria-labelledby={getTabId('history')} hidden={activeTab !== 'history'}>
          {activeTab === 'history' && (
            <MySubmissionsSection
              containerRef={(el) => {
                mySubmissionsRef.current = el;
              }}
              title={t('submit.historyTab', { defaultValue: 'History' })}
              mode="history"
              submissions={history}
              loading={loadingMySubmissions}
              onRefresh={loadMySubmissions}
            />
          )}
        </div>

        {canSeeChannelHistory && (
          <div role="tabpanel" id={getPanelId('channel')} aria-labelledby={getTabId('channel')} hidden={activeTab !== 'channel'}>
            {activeTab === 'channel' && (
              <ChannelSubmissionsSection
                submissions={channelSubmissions}
                loading={loadingChannelSubmissions}
                statusFilter={channelStatusFilter}
                query={channelQuery}
                selectedSubmitterId={selectedSubmitterId}
                selectedSubmitterName={selectedSubmitterName}
                onQueryChange={setChannelQuery}
                onStatusFilterChange={(s) => {
                  setChannelStatusFilter(s);
                  setChannelSubmissions([]);
                  void loadChannelHistory(s);
                }}
                onSelectSubmitter={(id, name) => {
                  setSelectedSubmitterId(id);
                  setSelectedSubmitterName(name);
                }}
                onClearSubmitter={() => {
                  setSelectedSubmitterId(null);
                  setSelectedSubmitterName(null);
                }}
                onRefresh={() => void loadChannelHistory()}
              />
            )}
          </div>
        )}
    </PageShell>
  );
}
