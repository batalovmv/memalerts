import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { Meme } from '@/types';

import { useDebounce } from '@/hooks/useDebounce';
import { api } from '@/lib/api';
import { getMemePrimaryId } from '@/shared/lib/memeIds';

export type AllMemesSearchScope = 'content' | 'contentAndUploader';
export type AllMemesSortBy = 'createdAt' | 'priceCoins';
export type AllMemesSortOrder = 'asc' | 'desc';

export function useAllMemesPanel(params: { isOpen: boolean; channelId: string; includeFileHash?: boolean }) {
  const { isOpen, channelId, includeFileHash } = params;

  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounce(query, 250);
  const [searchScope, setSearchScope] = useState<AllMemesSearchScope>('content');
  const [filters, setFilters] = useState<{ sortBy: AllMemesSortBy; sortOrder: AllMemesSortOrder }>({
    sortBy: 'createdAt',
    sortOrder: 'desc',
  });

  // Raw loaded items (pagination offset must be based on unfiltered length).
  const [items, setItems] = useState<Meme[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);
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
    p.set('channelId', channelId);
    // IMPORTANT:
    // To keep the dashboard "All memes" list identical to the public channel listing,
    // we MUST use the backend "channel listing mode" for /channels/memes/search.
    // That mode reads ChannelMeme (approved + not deleted) and returns the canonical DTO.
    // Passing params like q/includeUploader/tags/popularity may switch the backend into
    // legacy search mode (legacy Meme), producing a different shape and mismatched set.
    p.set('sortBy', filters.sortBy);
    p.set('sortOrder', filters.sortOrder);
    p.set('limit', String(limit));
    if (includeFileHash) p.set('includeFileHash', '1');
    return p;
  }, [channelId, filters, limit, includeFileHash]);

  const loadPage = async (offset: number) => {
    const p = new URLSearchParams(paramsBase);
    p.set('offset', String(offset));
    return await api.get<Meme[]>(`/channels/memes/search?${p.toString()}`);
  };

  const reload = useCallback(async () => {
    if (!isOpen) return;
    setError(null);
    setLoading(true);
    setHasMore(true);
    try {
      const first = await loadPage(0);
      setItems(first);
      setHasMore(first.length === limit);
    } catch {
      setItems([]);
      setHasMore(false);
      setError('failed');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, paramsBase.toString(), limit]);

  const memes = useMemo(() => {
    const q = debouncedQuery.trim().toLowerCase();
    if (!q) return items;
    return items.filter((m) => {
      const title = (m.title || '').toLowerCase();
      const uploader = (m.createdBy?.displayName || '').toLowerCase();
      if (searchScope === 'contentAndUploader') {
        return title.includes(q) || uploader.includes(q);
      }
      return title.includes(q);
    });
  }, [items, debouncedQuery, searchScope]);

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
                setItems((prev) => [...prev, ...next]);
                setHasMore(next.length === limit);
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
    searchScope,
    setSearchScope,
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
  };
}


