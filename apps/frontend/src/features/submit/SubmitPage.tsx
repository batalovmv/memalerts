import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import toast from 'react-hot-toast';

import Header from '@/components/Header';
import { api } from '@/lib/api';
import { useAppSelector } from '@/store/hooks';
import type { Submission, SubmissionStatus } from '@/types';

import type { MySubmission } from './types';
import { MySubmissionsSection } from './components/MySubmissionsSection';
import { ChannelSubmissionsSection } from './components/ChannelSubmissionsSection';

const SubmitModal = lazy(() => import('@/components/SubmitModal'));

export default function Submit() {
  const { t } = useTranslation();
  const { user } = useAppSelector((state) => state.auth);
  const navigate = useNavigate();

  const [isSubmitModalOpen, setIsSubmitModalOpen] = useState(false);

  const [mySubmissions, setMySubmissions] = useState<MySubmission[]>([]);
  const [loadingMySubmissions, setLoadingMySubmissions] = useState(false);

  const [activeTab, setActiveTab] = useState<'needs_changes' | 'history' | 'channel'>('history');
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
      const data = await api.get<any[]>('/submissions', { timeout: 10000 });
      const normalized = Array.isArray(data)
        ? data.map((s) => ({
            id: String(s.id),
            title: String(s.title || ''),
            status: String(s.status || ''),
            createdAt: String(s.createdAt || new Date().toISOString()),
            notes: (s.notes ?? null) as string | null,
            moderatorNotes: (s.moderatorNotes ?? null) as string | null,
            revision: typeof s.revision === 'number' ? s.revision : 0,
            tags: Array.isArray(s.tags) ? s.tags.map((x: any) => String(x?.tag?.name || '')).filter(Boolean) : [],
            submitterId: typeof s?.submitter?.id === 'string' ? s.submitter.id : typeof s?.submitterId === 'string' ? s.submitterId : null,
            submitterDisplayName:
              typeof s?.submitter?.displayName === 'string'
                ? s.submitter.displayName
                : typeof s?.submitterDisplayName === 'string'
                  ? s.submitterDisplayName
                  : null,
          }))
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

    const parsePage = (resp: any): { items: Submission[]; total: number | null } => {
      if (Array.isArray(resp)) return { items: resp as Submission[], total: (resp as Submission[]).length };
      if (resp && typeof resp === 'object' && Array.isArray(resp.items)) {
        const total = typeof resp.total === 'number' ? (resp.total as number) : null;
        return { items: (resp.items || []) as Submission[], total };
      }
      return { items: [], total: null };
    };

    try {
      setLoadingChannelSubmissions(true);

      // We don't know if backend supports `status=all`, so for "all" we fetch per-status and merge.
      const limit = 50;
      const fetchOne = async (status: SubmissionStatus) => {
        const resp = await api.get<any>('/streamer/submissions', {
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

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900">
      <Header />

      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
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

          <button
            type="button"
            onClick={() => setIsSubmitModalOpen(true)}
            className="bg-primary hover:bg-secondary text-white font-semibold py-2 px-4 rounded-lg transition-colors"
          >
            {t('submit.submitNewMeme', { defaultValue: 'Submit a new meme' })}
          </button>
        </div>

        <div className="mt-6 bg-white dark:bg-gray-800 rounded-lg shadow border border-secondary/20 p-2">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setActiveTab('needs_changes')}
              className={`px-3 py-2 rounded-lg text-sm font-semibold transition-colors ${
                activeTab === 'needs_changes'
                  ? 'bg-primary text-white'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600'
              }`}
            >
              {t('submit.needsChangesTab', { defaultValue: 'Needs changes' })}{' '}
              <span className="ml-1 opacity-80">({needsChanges.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('history')}
              className={`px-3 py-2 rounded-lg text-sm font-semibold transition-colors ${
                activeTab === 'history'
                  ? 'bg-primary text-white'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600'
              }`}
            >
              {t('submit.historyTab', { defaultValue: 'History' })}{' '}
              <span className="ml-1 opacity-80">({history.length})</span>
            </button>

            {canSeeChannelHistory && (
              <button
                type="button"
                onClick={() => setActiveTab('channel')}
                className={`px-3 py-2 rounded-lg text-sm font-semibold transition-colors ${
                  activeTab === 'channel'
                    ? 'bg-primary text-white'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600'
                }`}
              >
                {t('submit.channelHistoryTab', { defaultValue: 'Channel submissions' })}
              </button>
            )}
          </div>
        </div>

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

        {activeTab === 'channel' && canSeeChannelHistory && (
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
      </main>

      <Suspense fallback={null}>
        <SubmitModal isOpen={isSubmitModalOpen} onClose={() => setIsSubmitModalOpen(false)} />
      </Suspense>
    </div>
  );
}
