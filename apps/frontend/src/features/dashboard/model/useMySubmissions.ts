import { useCallback, useEffect, useRef, useState } from 'react';

import type { MySubmission } from '@/features/submit/types';
import type { User } from '@/types';

import { api } from '@/lib/api';
import { toRecord } from '@/shared/lib/parsing';

type UseMySubmissionsOptions = {
  user: User | null | undefined;
  shouldAutoLoad: boolean;
};

export function useMySubmissions({ user, shouldAutoLoad }: UseMySubmissionsOptions) {
  const [mySubmissions, setMySubmissions] = useState<MySubmission[]>([]);
  const [mySubmissionsLoading, setMySubmissionsLoading] = useState(false);
  const loadedRef = useRef(false);

  const loadMySubmissions = useCallback(
    async ({ force = false }: { force?: boolean } = {}) => {
      if (!user) return;
      if (loadedRef.current && !force) return;
      loadedRef.current = true;
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
              } as MySubmission;
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
    },
    [user],
  );

  useEffect(() => {
    loadedRef.current = false;
    setMySubmissions([]);
  }, [user?.id]);

  useEffect(() => {
    if (!shouldAutoLoad) return;
    void loadMySubmissions();
  }, [loadMySubmissions, shouldAutoLoad]);

  return {
    mySubmissions,
    mySubmissionsLoading,
    loadMySubmissions,
  };
}
