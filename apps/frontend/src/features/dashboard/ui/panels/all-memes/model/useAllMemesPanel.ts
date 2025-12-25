import { useEffect, useMemo, useRef, useState } from 'react';

import type { Meme } from '@/types';
import { useDebounce } from '@/hooks/useDebounce';
import { api } from '@/lib/api';

export type AllMemesSearchScope = 'content' | 'contentAndUploader';
export type AllMemesSortBy = 'createdAt' | 'popularity';
export type AllMemesSortOrder = 'asc' | 'desc';

export function useAllMemesPanel(params: { isOpen: boolean; channelId: string }) {
  const { isOpen, channelId } = params;

  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounce(query, 350);
  const [searchScope, setSearchScope] = useState<AllMemesSearchScope>('content');
  const [filters, setFilters] = useState<{ sortBy: AllMemesSortBy; sortOrder: AllMemesSortOrder }>({
    sortBy: 'createdAt',
    sortOrder: 'desc',
  });

  const [memes, setMemes] = useState<Meme[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  const limit = 40;

  // Remove deleted memes immediately (no refresh) when MemeModal deletes one.
  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ memeId?: string; channelId?: string }>;
      const memeId = ce.detail?.memeId;
      const deletedChannelId = ce.detail?.channelId;
      if (!memeId) return;
      if (deletedChannelId && deletedChannelId !== channelId) return;
      setMemes((prev) => prev.filter((m) => m.id !== memeId));
    };
    window.addEventListener('memalerts:memeDeleted', handler as EventListener);
    return () => window.removeEventListener('memalerts:memeDeleted', handler as EventListener);
  }, [channelId]);

  const paramsBase = useMemo(() => {
    const p = new URLSearchParams();
    p.set('channelId', channelId);
    if (debouncedQuery.trim()) p.set('q', debouncedQuery.trim());
    if (searchScope === 'contentAndUploader') p.set('includeUploader', '1');
    p.set('sortBy', filters.sortBy);
    p.set('sortOrder', filters.sortOrder);
    p.set('limit', String(limit));
    return p;
  }, [channelId, debouncedQuery, filters, searchScope, limit]);

  const loadPage = async (offset: number) => {
    const p = new URLSearchParams(paramsBase);
    p.set('offset', String(offset));
    return await api.get<Meme[]>(`/channels/memes/search?${p.toString()}`);
  };

  // Reset + load first page when panel opens or filters change
  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    setHasMore(true);
    void (async () => {
      try {
        const first = await loadPage(0);
        setMemes(first);
        setHasMore(first.length === limit);
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, paramsBase.toString()]);

  // Infinite scroll
  useEffect(() => {
    if (!isOpen) return;
    if (!hasMore) return;
    if (loading || loadingMore) return;
    const el = loadMoreRef.current;
    if (!el) return;

    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setLoadingMore(true);
            void (async () => {
              try {
                const next = await loadPage(memes.length);
                setMemes((prev) => [...prev, ...next]);
                setHasMore(next.length === limit);
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
  }, [isOpen, hasMore, loading, loadingMore, memes.length]); // eslint-disable-line react-hooks/exhaustive-deps

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
    loadMoreRef,
    limit,
  };
}


