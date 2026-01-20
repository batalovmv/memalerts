import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { Meme, MemeStatus } from '@/types';

import { useDebounce } from '@/hooks/useDebounce';
import { apiGetWithMeta } from '@/lib/api';
import { getMemePrimaryId } from '@/shared/lib/memeIds';
import { useAppSelector } from '@/store/hooks';

export type AllMemesSortOrder = 'asc' | 'desc';
export type AllMemesStatusFilter = 'all' | MemeStatus;

function parseBoolHeader(v: unknown): boolean | null {
  if (typeof v === 'boolean') return v;
  if (typeof v !== 'string') return null;
  const s = v.trim().toLowerCase();
  if (s === '1' || s === 'true' || s === 'yes') return true;
  if (s === '0' || s === 'false' || s === 'no') return false;
  return null;
}

function parseNumberHeader(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v !== 'string') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function useAllMemesPanel(params: { isOpen: boolean; channelId: string; includeFileHash?: boolean }) {
  const { isOpen, channelId, includeFileHash } = params;
  const { user } = useAppSelector((s) => s.auth);

  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounce(query, 250);
  const [filters, setFilters] = useState<{ status: AllMemesStatusFilter; sortOrder: AllMemesSortOrder }>({
    status: 'all',
    sortOrder: 'desc',
  });

  // Raw loaded items (pagination offset must be based on unfiltered length).
  const [items, setItems] = useState<Meme[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  const limit = 40;

  // Remove deleted memes immediately (no refresh) when MemeModal deletes one.
  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ memeId?: string; legacyMemeId?: string; channelId?: string }>;
      const memeId = ce.detail?.memeId;
      const legacyMemeId = ce.detail?.legacyMemeId;
      const deletedChannelId = ce.detail?.channelId;
      if (!memeId && !legacyMemeId) return;
      if (deletedChannelId && deletedChannelId !== channelId) return;
      setItems((prev) =>
        prev.filter((m) => {
          const pid = getMemePrimaryId(m);
          if (memeId && pid === memeId) return false;
          if (legacyMemeId && m.id === legacyMemeId) return false;
          return true;
        }),
      );
    };
    window.addEventListener('memalerts:memeDeleted', handler as EventListener);
    return () => window.removeEventListener('memalerts:memeDeleted', handler as EventListener);
  }, [channelId]);

  const paramsBase = useMemo(() => {
    const p = new URLSearchParams();
    p.set('sortOrder', filters.sortOrder);
    p.set('limit', String(limit));
    const q = debouncedQuery.trim();
    if (q) p.set('q', q.slice(0, 100));
    if (filters.status !== 'all') p.set('status', filters.status);
    if (includeFileHash) p.set('includeFileHash', '1');
    // Optional AI enrichment (admin / channel owner only).
    // Backend enforces permissions; UI gates to avoid leaking intent and wasted bytes.
    const canIncludeAi =
      !!user && (user.role === 'admin' || (user.role === 'streamer' && !!user.channelId && user.channelId === channelId));
    if (canIncludeAi) p.set('includeAi', '1');
    return p;
  }, [channelId, debouncedQuery, filters, limit, includeFileHash, user]);

  const loadPage = async (offset: number, opts?: { includeTotal?: boolean }) => {
    const p = new URLSearchParams(paramsBase);
    p.set('offset', String(offset));
    if (opts?.includeTotal) p.set('includeTotal', '1');
    return await apiGetWithMeta<Meme[]>(`/streamer/memes?${p.toString()}`);
  };

  const reload = useCallback(async () => {
    if (!isOpen) return;
    setError(null);
    setLoading(true);
    setHasMore(true);
    try {
      const first = await loadPage(0, { includeTotal: true });
      setItems(first.data);
      const hm = parseBoolHeader(first.meta.headers['x-has-more']);
      setHasMore(hm ?? first.data.length === limit);
      setTotalCount(parseNumberHeader(first.meta.headers['x-total-count']));
    } catch {
      setItems([]);
      setHasMore(false);
      setError('failed');
      setTotalCount(null);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, paramsBase.toString(), limit]);

  const memes = useMemo(() => items, [items]);

  // Reset + load first page when panel opens or filters change
  useEffect(() => {
    void reload();
  }, [reload]);

  // Infinite scroll
  useEffect(() => {
    if (!isOpen) return;
    if (!hasMore) return;
    if (loading || loadingMore) return;
    if (error) return;
    const el = loadMoreRef.current;
    if (!el) return;

    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setLoadingMore(true);
            void (async () => {
              try {
                const next = await loadPage(items.length);
                setItems((prev) => [...prev, ...next.data]);
                const hm = parseBoolHeader(next.meta.headers['x-has-more']);
                setHasMore(hm ?? next.data.length === limit);
              } catch {
                setHasMore(false);
                setError('failed');
              } finally {
                setLoadingMore(false);
              }
            })();
            return;
          }
        }
      },
      { root: null, rootMargin: '500px 0px', threshold: 0.01 },
    );

    obs.observe(el);
    return () => obs.disconnect();
  }, [isOpen, hasMore, loading, loadingMore, items.length, error]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    query,
    setQuery,
    filters,
    setFilters,
    memes,
    loading,
    loadingMore,
    hasMore,
    error,
    loadMoreRef,
    limit,
    reload,
    totalCount,
  };
}


