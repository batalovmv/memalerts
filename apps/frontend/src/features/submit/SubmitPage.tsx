import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { MySubmissionsSection } from './components/MySubmissionsSection';

import type { MySubmission } from './types';

import Header from '@/components/Header';
import { api } from '@/lib/api';
import { toRecord } from '@/shared/lib/parsing';
import { PageShell } from '@/shared/ui';
import { useAppSelector } from '@/store/hooks';

export default function Submit() {
  const { t } = useTranslation();
  const { user } = useAppSelector((state) => state.auth);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const tabsReactId = useId();
  const tabsIdBase = `submit-tabs-${tabsReactId.replace(/:/g, '')}`;
  type SubmitTab = 'needs_changes';

  const [mySubmissions, setMySubmissions] = useState<MySubmission[]>([]);
  const [loadingMySubmissions, setLoadingMySubmissions] = useState(false);

  const [activeTab, setActiveTab] = useState<SubmitTab>('needs_changes');
  const mySubmissionsRef = useRef<HTMLElement | null>(null);
  const defaultTabSetRef = useRef(false);

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

  // Optional deep-link: /submit?tab=needs_changes
  useEffect(() => {
    const tab = (searchParams.get('tab') || '').trim();
    if (tab !== 'needs_changes') return;

    defaultTabSetRef.current = true;
    setActiveTab(tab);
  }, [searchParams]);

  useEffect(() => {
    // Default tab: only once per page entry.
    if (defaultTabSetRef.current) return;
    if (loadingMySubmissions) return;
    defaultTabSetRef.current = true;
    setActiveTab('needs_changes');
  }, [loadingMySubmissions, mySubmissions]);

  const needsChanges = useMemo(
    () => mySubmissions.filter((s) => s.status === 'needs_changes'),
    [mySubmissions],
  );

  if (!user) {
    return null;
  }

  const getTabId = (tab: SubmitTab) => `${tabsIdBase}-tab-${tab}`;
  const getPanelId = (tab: SubmitTab) => `${tabsIdBase}-panel-${tab}`;

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
    </PageShell>
  );
}
