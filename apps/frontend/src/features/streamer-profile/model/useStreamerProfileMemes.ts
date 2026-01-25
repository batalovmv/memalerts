import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { ChannelInfo } from '@/features/streamer-profile/model/types';
import type { Meme, User } from '@/types';
import type { MutableRefObject } from 'react';

import {
  extractMemesFromResponse,
  fetchChannelMemesSearch,
  fetchMemesPool,
  mergeMemesById,
} from '@/features/streamer-profile/model/utils';
import { api } from '@/lib/api';
import { getOwnerAiStatus } from '@/shared/api/owner';
import { useDebounce } from '@/shared/lib/hooks';
import { getMemePrimaryId } from '@/shared/lib/memeIds';

const normalizeSearchQuery = (value: string): string =>
  String(value || '')
    .toLowerCase()
    .replace(/["'<>]/g, '')
    .replace(/[^\p{L}0-9]+/giu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const extractTagNames = (meme: Meme): string[] => {
  const names = new Set<string>();
  if (Array.isArray(meme.aiAutoTagNames)) {
    meme.aiAutoTagNames.forEach((tag) => {
      if (typeof tag === 'string' && tag.trim()) names.add(tag.trim().toLowerCase());
    });
  }
  if (Array.isArray(meme.tags)) {
    meme.tags.forEach((item) => {
      const name = item?.tag?.name;
      if (typeof name === 'string' && name.trim()) names.add(name.trim().toLowerCase());
    });
  }
  return Array.from(names);
};

const scoreTermMatch = (text: string, term: string): number => {
  if (!text || !term) return 0;
  if (text === term) return 100;
  if (text.startsWith(term)) return 80;
  if (text.includes(term)) return 60;
  if (term.startsWith(text) && text.length >= 3) return 40;
  return 0;
};

const scoreTextMatch = (text: string, term: string, tokens: string[]): number => {
  const normalized = normalizeSearchQuery(text);
  if (!normalized) return 0;
  let best = scoreTermMatch(normalized, term);
  for (const token of tokens) {
    best = Math.max(best, scoreTermMatch(normalized, token));
  }
  return best;
};

const scoreMemeMatch = (meme: Meme, term: string, tokens: string[]): number => {
  const titleScore = scoreTextMatch(meme.title || '', term, tokens) * 2;
  const descScore =
    typeof meme.aiAutoDescription === 'string'
      ? scoreTextMatch(meme.aiAutoDescription, term, tokens)
      : 0;
  const tagNames = extractTagNames(meme);
  let tagScore = 0;
  for (const tag of tagNames) {
    tagScore = Math.max(tagScore, scoreTermMatch(tag, term));
    for (const token of tokens) {
      tagScore = Math.max(tagScore, scoreTermMatch(tag, token));
    }
  }
  return tagScore * 3 + titleScore + descScore;
};

const rankSearchResults = (items: Meme[], query: string): Meme[] => {
  const normalized = normalizeSearchQuery(query);
  if (!normalized) return items;
  const tokens = normalized.split(' ').filter(Boolean);
  const scored = items.map((meme, index) => ({
    meme,
    index,
    score: scoreMemeMatch(meme, normalized, tokens),
  }));
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.index - b.index;
  });
  return scored.map((item) => item.meme);
};

type UseStreamerProfileMemesParams = {
  channelInfo: ChannelInfo | null;
  normalizedSlug: string;
  user: User | null;
  isAuthed: boolean;
  reloadNonce: number;
  onReloadChannel: () => void;
};

type UseStreamerProfileMemesState = {
  memes: Meme[];
  memesLoading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  loadMoreRef: MutableRefObject<HTMLDivElement | null>;
  searchQuery: string;
  setSearchQuery: (next: string) => void;
  tagFilter: string;
  setTagFilter: (next: string) => void;
  myFavorites: boolean;
  setMyFavorites: (next: boolean | ((prev: boolean) => boolean)) => void;
  searchResults: Meme[];
  isSearching: boolean;
  hasAiProcessing: boolean;
};

const MEMES_PER_PAGE = 40;

export function useStreamerProfileMemes({
  channelInfo,
  normalizedSlug,
  user,
  isAuthed,
  reloadNonce,
  onReloadChannel,
}: UseStreamerProfileMemesParams): UseStreamerProfileMemesState {
  const [memes, setMemes] = useState<Meme[]>([]);
  const [memesLoading, setMemesLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [memesOffset, setMemesOffset] = useState(0);
  const [searchResults, setSearchResults] = useState<Meme[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [myFavorites, setMyFavorites] = useState(false);
  const [ownerAiProcessingCount, setOwnerAiProcessingCount] = useState(0);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const lastLoadKeyRef = useRef<string>('');

  const debouncedSearchQuery = useDebounce(searchQuery, 500);

  const isOwner = useMemo(() => !!(user && channelInfo && user.channelId === channelInfo.id), [channelInfo, user]);
  const canIncludeFileHash = useMemo(
    () => !!(user && channelInfo && (user.role === 'admin' || user.channelId === channelInfo.id)),
    [channelInfo, user],
  );
  const canIncludeAi = useMemo(
    () => !!(user && channelInfo && (user.role === 'admin' || user.channelId === channelInfo.id)),
    [channelInfo, user],
  );

  // Remove deleted memes immediately (no refresh) when streamer deletes from dashboard.
  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ memeId?: string; legacyMemeId?: string }>;
      const memeId = ce.detail?.memeId;
      const legacyMemeId = ce.detail?.legacyMemeId;
      if (!memeId && !legacyMemeId) return;
      setMemes((prev) =>
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
  }, []);

  // Refresh meme list when owner uploads/imports a meme (SubmitModal dispatches this).
  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ channelId?: string }>;
      const channelId = ce.detail?.channelId;
      if (!channelId || !channelInfo?.id) return;
      if (String(channelId) !== String(channelInfo.id)) return;
      onReloadChannel();
    };
    window.addEventListener('memalerts:channelMemesUpdated', handler as EventListener);
    return () => window.removeEventListener('memalerts:channelMemesUpdated', handler as EventListener);
  }, [channelInfo?.id, onReloadChannel]);

  // Initial meme load (and reload after manual refresh).
  useEffect(() => {
    if (!channelInfo?.id) return;

    const loadKey = `${channelInfo.id}:${channelInfo.memeCatalogMode || 'channel'}:${reloadNonce}`;
    if (lastLoadKeyRef.current === loadKey) return;
    lastLoadKeyRef.current = loadKey;

    setMemesLoading(true);
    setMemes([]);
    setSearchResults([]);
    setHasMore(true);
    setMemesOffset(0);

    const load = async () => {
      try {
        // NOTE: Some backends expose pool_all catalog via `/public/channels/:slug/memes/search`.
        // Prefer it for pool_all mode, but keep a fallback to `/channels/memes/search` for back-compat.
        if (channelInfo.memeCatalogMode === 'pool_all') {
          // On production/beta deployments, the only reliable "global pool" endpoint is `/memes/pool`.
          // Channel-scoped `/public/channels/:slug/memes/search` may be missing and fall back to SPA HTML.
          try {
            const poolMemes = await fetchMemesPool({ limit: MEMES_PER_PAGE, offset: 0, timeoutMs: 15000 });
            setMemes(poolMemes);
            setHasMore(poolMemes.length === MEMES_PER_PAGE);
          } catch {
            // If pool is not accessible (beta gating / auth), fall back to channel listings.
            const listParams = new URLSearchParams();
            listParams.set('channelSlug', String(channelInfo.slug || normalizedSlug).toLowerCase());
            listParams.set('limit', String(MEMES_PER_PAGE));
            listParams.set('offset', '0');
            listParams.set('sortBy', 'createdAt');
            listParams.set('sortOrder', 'desc');
            if (canIncludeFileHash) listParams.set('includeFileHash', '1');
            if (canIncludeAi) listParams.set('includeAi', '1');
            listParams.set('_ts', String(Date.now()));
            let resp: unknown = null;
            try {
              resp = await fetchChannelMemesSearch({
                channelSlug: String(channelInfo.slug || normalizedSlug).toLowerCase(),
                params: listParams,
                preferPublic: true,
                timeoutMs: 15000,
              });
            } catch {
              const fallbackParams = new URLSearchParams(listParams);
              fallbackParams.delete('channelSlug');
              fallbackParams.set('channelId', channelInfo.id);
              resp = await api.get<unknown>(`/channels/memes/search?${fallbackParams.toString()}`, {
                timeout: 15000,
                headers: { 'Cache-Control': 'no-store' },
              });
            }
            const initial = extractMemesFromResponse(resp);
            setMemes(initial);
            setHasMore(initial.length === MEMES_PER_PAGE);
          }
        } else {
          const listParams = new URLSearchParams();
          listParams.set('channelSlug', String(channelInfo.slug || normalizedSlug).toLowerCase());
          listParams.set('limit', String(MEMES_PER_PAGE));
          listParams.set('offset', '0');
          listParams.set('sortBy', 'createdAt');
          listParams.set('sortOrder', 'desc');
          if (canIncludeFileHash) listParams.set('includeFileHash', '1');
          if (canIncludeAi) listParams.set('includeAi', '1');
          // Avoid stale cache after recent settings toggles.
          listParams.set('_ts', String(Date.now()));
          let resp: unknown = null;
          try {
            resp = await fetchChannelMemesSearch({
              channelSlug: String(channelInfo.slug || normalizedSlug).toLowerCase(),
              params: listParams,
              timeoutMs: 15000,
            });
          } catch {
            // Back-compat fallback: some backends may only support channelId on the non-public endpoint.
            const fallbackParams = new URLSearchParams(listParams);
            fallbackParams.delete('channelSlug');
            fallbackParams.set('channelId', channelInfo.id);
            resp = await api.get<unknown>(`/channels/memes/search?${fallbackParams.toString()}`, {
              timeout: 15000,
              headers: { 'Cache-Control': 'no-store' },
            });
          }
          const initial = extractMemesFromResponse(resp);
          setMemes(initial);
          setHasMore(initial.length === MEMES_PER_PAGE);
        }
      } catch {
        // Continue without memes - they can be loaded later.
        setHasMore(false);
      } finally {
        setMemesLoading(false);
      }
    };

    void load();
  }, [canIncludeAi, canIncludeFileHash, channelInfo, normalizedSlug, reloadNonce]);

  // Load more memes function
  const loadMoreMemes = useCallback(async () => {
    if (!channelInfo || loadingMore || !hasMore || searchQuery.trim() || tagFilter.trim() || myFavorites) {
      return;
    }

    setLoadingMore(true);
    try {
      const nextOffset = memesOffset + MEMES_PER_PAGE;
      let newMemes: Meme[] = [];
      if (channelInfo.memeCatalogMode === 'pool_all') {
        try {
          newMemes = await fetchMemesPool({ limit: MEMES_PER_PAGE, offset: nextOffset, timeoutMs: 15000 });
        } catch {
          newMemes = [];
        }
      } else {
        const listParams = new URLSearchParams();
        listParams.set('channelSlug', String(channelInfo.slug || normalizedSlug).toLowerCase());
        listParams.set('limit', String(MEMES_PER_PAGE));
        listParams.set('offset', String(nextOffset));
        listParams.set('sortBy', 'createdAt');
        listParams.set('sortOrder', 'desc');
        if (canIncludeFileHash) listParams.set('includeFileHash', '1');
        if (canIncludeAi) listParams.set('includeAi', '1');
        listParams.set('_ts', String(Date.now()));

        let resp: unknown;
        try {
          resp = await fetchChannelMemesSearch({
            channelSlug: String(channelInfo.slug || normalizedSlug).toLowerCase(),
            params: listParams,
            timeoutMs: 15000,
          });
        } catch {
          const fallbackParams = new URLSearchParams(listParams);
          fallbackParams.delete('channelSlug');
          fallbackParams.set('channelId', channelInfo.id);
          resp = await api.get<unknown>(`/channels/memes/search?${fallbackParams.toString()}`, {
            timeout: 15000,
            headers: { 'Cache-Control': 'no-store' },
          });
        }
        newMemes = extractMemesFromResponse(resp);
      }

      if (newMemes.length > 0) {
        setMemes((prev) => [...prev, ...newMemes]);
        setMemesOffset(nextOffset);
        setHasMore(newMemes.length === MEMES_PER_PAGE);
      } else {
        setHasMore(false);
      }
    } catch {
      setHasMore(false);
    } finally {
      setLoadingMore(false);
    }
  }, [
    canIncludeAi,
    canIncludeFileHash,
    channelInfo,
    hasMore,
    loadingMore,
    memesOffset,
    myFavorites,
    normalizedSlug,
    searchQuery,
    tagFilter,
  ]);

  // Intersection Observer for infinite scroll
  useEffect(() => {
    if (!loadMoreRef.current || searchQuery.trim() || tagFilter.trim() || myFavorites || !channelInfo?.id) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loadingMore && !memesLoading) {
          loadMoreMemes();
        }
      },
      { threshold: 0.1 },
    );

    const currentRef = loadMoreRef.current;
    observer.observe(currentRef);

    return () => {
      observer.disconnect();
    };
  }, [channelInfo?.id, hasMore, loadMoreMemes, loadingMore, memesLoading, myFavorites, searchQuery, tagFilter]);

  // Perform search when debounced query changes
  useEffect(() => {
    const tagValue = tagFilter.trim();
    const hasTagFilter = tagValue.length > 0;
    if (!normalizedSlug || (!debouncedSearchQuery.trim() && !myFavorites && !hasTagFilter)) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    const performSearch = async () => {
      setIsSearching(true);
      try {
        // Favorites search requires auth; for regular search use safe public endpoint.
        if (myFavorites && !isAuthed) {
          setSearchResults([]);
          return;
        }

        const params = new URLSearchParams();
        if (debouncedSearchQuery.trim()) params.set('q', debouncedSearchQuery.trim());
        if (hasTagFilter) params.set('tags', tagValue);
        params.set('limit', '100');
        params.set('sortBy', 'createdAt');
        params.set('sortOrder', 'desc');

        let memesResp: unknown;
        if (myFavorites) {
          memesResp = await api.get<unknown>(
            `/channels/memes/search?${(() => {
              const p = new URLSearchParams(params);
              p.set('channelSlug', normalizedSlug);
              p.set('favorites', '1');
              if (canIncludeAi) p.set('includeAi', '1');
              return p.toString();
            })()}`,
          );
        } else {
          if (channelInfo?.memeCatalogMode === 'pool_all') {
            const poolQuery = debouncedSearchQuery.trim();
            const pool = await fetchMemesPool({
              limit: 100,
              offset: 0,
              q: poolQuery || undefined,
              tags: hasTagFilter ? tagValue : undefined,
              timeoutMs: 15000,
            });
            const ranked = poolQuery ? rankSearchResults(pool, poolQuery) : pool;
            setSearchResults(ranked);
            return;
          }
          const searchParams = new URLSearchParams(params);
          if (channelInfo?.slug || normalizedSlug) {
            searchParams.set('channelSlug', String(channelInfo?.slug || normalizedSlug).toLowerCase());
          } else if (channelInfo?.id) {
            // Back-compat only.
            searchParams.set('channelId', channelInfo.id);
          }
          if (canIncludeAi) searchParams.set('includeAi', '1');
          // Avoid stale cache after recent toggles.
          searchParams.set('_ts', String(Date.now()));

          try {
            memesResp = await fetchChannelMemesSearch({
              channelSlug: String(channelInfo?.slug || normalizedSlug).toLowerCase(),
              params: searchParams,
              // We already early-returned for pool_all above, so this branch is channel-only.
              preferPublic: false,
              timeoutMs: 15000,
            });
          } catch {
            // Back-compat fallback (no /public/* to avoid SPA-fallback noise in prod).
            if (channelInfo?.id) {
              const fallbackParams = new URLSearchParams(params);
              fallbackParams.set('channelId', channelInfo.id);
              fallbackParams.set('_ts', String(Date.now()));
              memesResp = await api.get<unknown>(`/channels/memes/search?${fallbackParams.toString()}`, {
                headers: { 'Cache-Control': 'no-store' },
              });
            } else {
              throw new Error('Failed to search memes');
            }
          }
        }
        const found = extractMemesFromResponse(memesResp);
        const ranked = debouncedSearchQuery.trim() ? rankSearchResults(found, debouncedSearchQuery) : found;
        setSearchResults(ranked);
      } catch {
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    };

    void performSearch();
  }, [canIncludeAi, channelInfo, debouncedSearchQuery, isAuthed, myFavorites, normalizedSlug, tagFilter]);

  const hasAiProcessingInList = memes.some((m) => m.aiStatus === 'pending' || m.aiStatus === 'processing');
  const hasOwnerAiProcessing = ownerAiProcessingCount > 0;
  const hasAiProcessing = hasAiProcessingInList || hasOwnerAiProcessing;

  // Owner AI status polling (drives visible processing indicator + list refresh even before the meme appears).
  useEffect(() => {
    const channelSlug = String(channelInfo?.slug || normalizedSlug).toLowerCase();
    if (!isOwner || !channelSlug) return;
    if (channelInfo?.memeCatalogMode === 'pool_all') return;

    let cancelled = false;
    let timer: number | null = null;

    const load = async () => {
      try {
        const res = await getOwnerAiStatus({ take: 50 });
        const items = res.processing.items.filter((item) => String(item.channelSlug || '').toLowerCase() === channelSlug);
        if (!cancelled) setOwnerAiProcessingCount(items.length);
        const nextDelay = items.length > 0 ? 6000 : 12000;
        if (!cancelled) {
          timer = window.setTimeout(load, nextDelay);
        }
      } catch {
        if (!cancelled) setOwnerAiProcessingCount(0);
        if (!cancelled) {
          timer = window.setTimeout(load, 12000);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [channelInfo?.memeCatalogMode, channelInfo?.slug, isOwner, normalizedSlug]);

  // Auto-refresh AI-enriched fields while AI is processing (owner/admin only).
  useEffect(() => {
    const channelId = channelInfo?.id || '';
    const channelSlug = String(channelInfo?.slug || normalizedSlug).toLowerCase();
    if (!canIncludeAi || !channelId) return;
    if (channelInfo?.memeCatalogMode === 'pool_all') return;
    if (memesLoading || loadingMore) return;
    if (searchQuery.trim() || myFavorites || tagFilter.trim()) return;
    if (!hasAiProcessing) return;

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      if (cancelled) return;
      try {
        const listParams = new URLSearchParams();
        listParams.set('channelSlug', channelSlug);
        listParams.set('limit', String(Math.max(MEMES_PER_PAGE, Math.min(memes.length || 0, 200))));
        listParams.set('offset', '0');
        listParams.set('sortBy', 'createdAt');
        listParams.set('sortOrder', 'desc');
        listParams.set('includeAi', '1');
        listParams.set('_ts', String(Date.now()));

        let resp: unknown;
        try {
          resp = await fetchChannelMemesSearch({
            channelSlug,
            params: listParams,
            timeoutMs: 15000,
          });
        } catch {
          const fallbackParams = new URLSearchParams(listParams);
          fallbackParams.delete('channelSlug');
          fallbackParams.set('channelId', channelId);
          resp = await api.get<unknown>(`/channels/memes/search?${fallbackParams.toString()}`, {
            timeout: 15000,
            headers: { 'Cache-Control': 'no-store' },
          });
        }

        const latest = extractMemesFromResponse(resp);
        if (!cancelled && latest.length > 0) {
          setMemes((prev) => mergeMemesById(prev, latest));
        }
      } catch {
        // ignore background refresh errors
      }
    }, 6000);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    canIncludeAi,
    channelInfo?.id,
    channelInfo?.slug,
    channelInfo?.memeCatalogMode,
    hasAiProcessing,
    memes,
    memesLoading,
    loadingMore,
    myFavorites,
    normalizedSlug,
    searchQuery,
    tagFilter,
  ]);

  return {
    memes,
    memesLoading,
    loadingMore,
    hasMore,
    loadMoreRef,
    searchQuery,
    setSearchQuery,
    tagFilter,
    setTagFilter,
    myFavorites,
    setMyFavorites,
    searchResults,
    isSearching,
    hasAiProcessing,
  };
}
