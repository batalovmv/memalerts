import { useEffect, useState, useRef, useCallback } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { useParams, useNavigate } from 'react-router-dom';

import type { Meme, Wallet } from '@/types';

import AuthRequiredModal from '@/components/AuthRequiredModal';
import ChannelThemeProvider from '@/components/ChannelThemeProvider';
import CoinsInfoModal from '@/components/CoinsInfoModal';
import Header from '@/components/Header';
import MemeCard from '@/components/MemeCard';
import MemeModal from '@/components/MemeModal';
import { YouTubeLikeClaimButton } from '@/components/Rewards/YouTubeLikeClaimButton';
import SubmitModal from '@/components/SubmitModal';
import { useSocket } from '@/contexts/SocketContext';
import { useAutoplayMemes } from '@/hooks/useAutoplayMemes';
import { useDebounce } from '@/hooks/useDebounce';
import { api } from '@/lib/api';
import { login } from '@/lib/auth';
import { resolveMediaUrl } from '@/lib/urls';
import { getMemePrimaryId } from '@/shared/lib/memeIds';
import { Button, HelpTooltip, IconButton, Input, PageShell, Pill, Spinner } from '@/shared/ui';
import { useAppSelector, useAppDispatch } from '@/store/hooks';
import { updateWalletBalance } from '@/store/slices/authSlice';
import { activateMeme } from '@/store/slices/memesSlice';

interface ChannelInfo {
  id: string;
  slug: string;
  name: string;
  memeCatalogMode?: 'channel' | 'pool_all';
  coinPerPointRatio: number;
  youtubeLikeRewardEnabled?: boolean;
  youtubeLikeRewardCoins?: number;
  youtubeLikeRewardOnlyWhenLive?: boolean;
  coinIconUrl?: string | null;
  rewardTitle?: string | null;
  primaryColor?: string | null;
  secondaryColor?: string | null;
  accentColor?: string | null;
  submissionsEnabled?: boolean;
  submissionsOnlyWhenLive?: boolean;
  createdAt: string;
  memes: Meme[];
  owner?: {
    id: string;
    displayName: string;
    profileImageUrl?: string | null;
  } | null;
  stats: {
    memesCount: number;
    usersCount: number;
  };
}

function toRecord(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== 'object') return null;
  if (Array.isArray(v)) return null;
  return v as Record<string, unknown>;
}

function looksLikeSpaHtml(data: unknown): boolean {
  if (typeof data !== 'string') return false;
  const head = data.slice(0, 256).toLowerCase();
  return head.includes('<!doctype html') || head.includes('<html');
}

async function fetchChannelMemesSearch(opts: {
  channelSlug: string;
  params: URLSearchParams;
  preferPublic?: boolean;
  timeoutMs?: number;
}): Promise<unknown> {
  const slug = String(opts.channelSlug || '').trim();
  const timeout = typeof opts.timeoutMs === 'number' ? opts.timeoutMs : 15000;

  const publicParams = new URLSearchParams(opts.params);
  // Public endpoint already scopes by slug in path.
  publicParams.delete('channelSlug');
  publicParams.delete('channelId');

  const publicUrl = `/public/channels/${encodeURIComponent(slug)}/memes/search?${publicParams.toString()}`;
  const channelUrl = `/channels/memes/search?${opts.params.toString()}`;

  const doPublic = async () => {
    const resp = await api.get<unknown>(publicUrl, {
      timeout,
      headers: { 'Cache-Control': 'no-store' },
    });
    if (looksLikeSpaHtml(resp)) {
      throw new Error('Public channel memes endpoint returned HTML');
    }
    return resp;
  };

  const doChannel = async () =>
    api.get<unknown>(channelUrl, {
      timeout,
      headers: { 'Cache-Control': 'no-store' },
    });

  if (opts.preferPublic) {
    try {
      return await doPublic();
    } catch {
      return await doChannel();
    }
  }

  try {
    return await doChannel();
  } catch {
    return await doPublic();
  }
}

function normalizeChannelInfo(raw: unknown, fallbackSlug: string): ChannelInfo | null {
  const r = toRecord(raw);
  if (!r) return null;

  const id = typeof r.id === 'string' ? r.id : null;
  const name = typeof r.name === 'string' ? r.name : null;
  const slug = typeof r.slug === 'string' && r.slug.trim() ? r.slug.trim() : fallbackSlug;
  if (!id || !name) return null;

  const memeCatalogMode =
    r.memeCatalogMode === 'pool_all' || r.memeCatalogMode === 'channel' ? (r.memeCatalogMode as 'pool_all' | 'channel') : undefined;

  const ownerRaw = toRecord(r.owner);
  const owner = ownerRaw
    ? {
        id: typeof ownerRaw.id === 'string' ? ownerRaw.id : '',
        displayName: typeof ownerRaw.displayName === 'string' ? ownerRaw.displayName : '',
        profileImageUrl: typeof ownerRaw.profileImageUrl === 'string' ? ownerRaw.profileImageUrl : null,
      }
    : null;

  const statsRaw = toRecord(r.stats);
  const memesCount = typeof statsRaw?.memesCount === 'number' && Number.isFinite(statsRaw.memesCount) ? statsRaw.memesCount : 0;
  const usersCount = typeof statsRaw?.usersCount === 'number' && Number.isFinite(statsRaw.usersCount) ? statsRaw.usersCount : 0;

  return {
    id,
    slug,
    name,
    memeCatalogMode,
    coinPerPointRatio: typeof r.coinPerPointRatio === 'number' && Number.isFinite(r.coinPerPointRatio) ? r.coinPerPointRatio : 0,
    youtubeLikeRewardEnabled: typeof r.youtubeLikeRewardEnabled === 'boolean' ? r.youtubeLikeRewardEnabled : undefined,
    youtubeLikeRewardCoins:
      typeof r.youtubeLikeRewardCoins === 'number' && Number.isFinite(r.youtubeLikeRewardCoins) ? r.youtubeLikeRewardCoins : undefined,
    youtubeLikeRewardOnlyWhenLive: typeof r.youtubeLikeRewardOnlyWhenLive === 'boolean' ? r.youtubeLikeRewardOnlyWhenLive : undefined,
    coinIconUrl: typeof r.coinIconUrl === 'string' ? r.coinIconUrl : r.coinIconUrl === null ? null : null,
    rewardTitle: typeof r.rewardTitle === 'string' ? r.rewardTitle : r.rewardTitle === null ? null : null,
    primaryColor: typeof r.primaryColor === 'string' ? r.primaryColor : r.primaryColor === null ? null : null,
    secondaryColor: typeof r.secondaryColor === 'string' ? r.secondaryColor : r.secondaryColor === null ? null : null,
    accentColor: typeof r.accentColor === 'string' ? r.accentColor : r.accentColor === null ? null : null,
    submissionsEnabled: typeof r.submissionsEnabled === 'boolean' ? r.submissionsEnabled : undefined,
    submissionsOnlyWhenLive: typeof r.submissionsOnlyWhenLive === 'boolean' ? r.submissionsOnlyWhenLive : undefined,
    createdAt: typeof r.createdAt === 'string' ? r.createdAt : new Date().toISOString(),
    memes: [],
    owner,
    stats: { memesCount, usersCount },
  };
}

export default function StreamerProfile() {
  const { t } = useTranslation();
  const { slug } = useParams<{ slug: string }>();
  const { user } = useAppSelector((state) => state.auth);
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { socket, isConnected } = useSocket();
  
  const [channelInfo, setChannelInfo] = useState<ChannelInfo | null>(null);
  const [channelLoadError, setChannelLoadError] = useState<null | 'auth_required' | 'forbidden' | 'beta_required' | 'not_found' | 'failed'>(null);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [loading, setLoading] = useState(true);
  const [memes, setMemes] = useState<Meme[]>([]);
  const [memesLoading, setMemesLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [memesOffset, setMemesOffset] = useState(0);
  const MEMES_PER_PAGE = 40;
  const [selectedMeme, setSelectedMeme] = useState<Meme | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSubmitModalOpen, setIsSubmitModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [myFavorites, setMyFavorites] = useState(false);
  const [authModalOpen, setAuthModalOpen] = useState(false);

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
  const [searchResults, setSearchResults] = useState<Meme[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  
  const debouncedSearchQuery = useDebounce(searchQuery, 500);
  const { autoplayMemesEnabled } = useAutoplayMemes();

  const normalizedSlug = (slug || '').trim().toLowerCase();
  const isAuthed = !!user;
  const lastLoadKeyRef = useRef<string>(''); // prevents duplicate initial loads when auth state hydrates

  // (Removed) public-profile hover-sound toggle: keep current behavior without a user-visible switch.

  // Helpers: use CSS variables (set by ChannelThemeProvider) to build subtle tints safely.
  // We avoid Tailwind color opacity modifiers here because theme colors are CSS vars (hex), and
  // utilities like `border-secondary/30` may not render as expected with `var(--color)`.
  const mix = (cssVar: '--primary-color' | '--secondary-color' | '--accent-color', percent: number) =>
    `color-mix(in srgb, var(${cssVar}) ${percent}%, transparent)`;

  useEffect(() => {
    if (!normalizedSlug) {
      navigate('/');
      return;
    }

    // This effect depends on `user`/`isAuthed`, so it can re-run when auth hydrates.
    // Avoid reloading the whole page (and refetching memes twice) unless slug or reloadNonce changed.
    const loadKey = `${normalizedSlug}:${reloadNonce}`;
    if (lastLoadKeyRef.current === loadKey) return;
    lastLoadKeyRef.current = loadKey;

    const loadChannelData = async () => {
      // Reset state for a clean retry / slug change.
      setLoading(true);
      setChannelLoadError(null);
      setChannelInfo(null);
      setWallet(null);
      setMemes([]);
      setSearchResults([]);
      setHasMore(true);
      setMemesOffset(0);
      try {
        // Public profile must use public API as canonical source.
        // When unauthenticated, avoid hitting the authed endpoint (it can 401 and also triggers CORS preflights in tests).
        let channelInfoRaw: unknown;
        const channelInfoParams = new URLSearchParams();
        channelInfoParams.set('includeMemes', 'false');
        // Avoid stale cache after recent settings toggles (nginx/CDN/browser).
        channelInfoParams.set('_ts', String(Date.now()));
        const channelInfoUrl = `/channels/${normalizedSlug}?${channelInfoParams.toString()}`;
        const publicChannelInfoUrl = `/public/channels/${normalizedSlug}?${channelInfoParams.toString()}`;
        if (!isAuthed) {
          // Prefer canonical /channels/* (works in prod; /public/* may be served by SPA fallback in some nginx configs).
          try {
            channelInfoRaw = await api.get<unknown>(channelInfoUrl, {
              timeout: 15000,
              headers: { 'Cache-Control': 'no-store' },
            });
          } catch {
            channelInfoRaw = await api.get<unknown>(publicChannelInfoUrl, {
              timeout: 15000,
              headers: { 'Cache-Control': 'no-store' },
            });
            if (looksLikeSpaHtml(channelInfoRaw)) {
              throw new Error('Public channel endpoint returned HTML');
            }
          }
        } else {
          try {
            // Prefer authenticated channel DTO (it includes reward flags like youtubeLikeReward*).
            channelInfoRaw = await api.get<unknown>(channelInfoUrl, {
              timeout: 15000,
              headers: { 'Cache-Control': 'no-store' },
            });
          } catch {
            channelInfoRaw = await api.get<unknown>(publicChannelInfoUrl, {
              timeout: 15000,
              headers: { 'Cache-Control': 'no-store' },
            });
            if (looksLikeSpaHtml(channelInfoRaw)) {
              throw new Error('Public channel endpoint returned HTML');
            }
          }
        }
        const channelInfo = normalizeChannelInfo(channelInfoRaw, normalizedSlug);
        if (!channelInfo) {
          throw new Error('Channel info missing');
        }
        setChannelInfo({ ...channelInfo, memes: [] }); // Set memes to empty array initially
        setLoading(false); // Channel info loaded, can show page structure

        // Canonicalize URL (prevents case-sensitive slug issues on production)
        if (slug && channelInfo.slug && slug !== channelInfo.slug) {
          navigate(`/channel/${channelInfo.slug}`, { replace: true });
        }
        
        // Load memes separately with pagination
        setMemesLoading(true);
        try {
          const canIncludeFileHash = !!(user && (user.role === 'admin' || user.channelId === channelInfo.id));
          // NOTE: Some backends expose pool_all catalog via `/public/channels/:slug/memes/search`.
          // Prefer it for pool_all mode, but keep a fallback to `/channels/memes/search` for back-compat.
          const listParams = new URLSearchParams();
          listParams.set('channelSlug', (channelInfo.slug || normalizedSlug).toLowerCase());
          listParams.set('limit', String(MEMES_PER_PAGE));
          listParams.set('offset', '0');
          listParams.set('sortBy', 'createdAt');
          listParams.set('sortOrder', 'desc');
          if (canIncludeFileHash) listParams.set('includeFileHash', '1');
          // Avoid stale cache after recent settings toggles.
          listParams.set('_ts', String(Date.now()));
          let resp: unknown = null;
          try {
            resp = await fetchChannelMemesSearch({
              channelSlug: (channelInfo.slug || normalizedSlug).toLowerCase(),
              params: listParams,
              preferPublic: channelInfo.memeCatalogMode === 'pool_all',
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

          const memes = Array.isArray(resp) ? (resp as Meme[]) : [];
          setMemes(memes);
          setHasMore(memes.length === MEMES_PER_PAGE);
        } catch (error) {
          // Continue without memes - they can be loaded later
          setHasMore(false);
        } finally {
          setMemesLoading(false);
        }
        
        // If user is logged in, load their wallet for this channel
        // Use user.wallets from Redux first (Socket.IO will update it automatically)
        if (user && channelInfo) {
          // Check if wallet exists in user.wallets first
          const userWallet = user.wallets?.find(w => w.channelId === channelInfo.id);
          if (userWallet) {
            setWallet(userWallet);
          } else {
            // Only fetch if wallet not in Redux
            try {
              const wallet = await api.get<Wallet>(`/channels/${channelInfo.slug}/wallet`, {
                timeout: 10000, // 10 second timeout
              });
              setWallet(wallet);
              // Update Redux store
              dispatch(updateWalletBalance({ 
                channelId: wallet.channelId, 
                balance: wallet.balance 
              }));
            } catch (error: unknown) {
              const apiError = error as { response?: { status?: number }; code?: string };
              // If wallet doesn't exist or times out, set default wallet
              if (apiError.response?.status === 404 || apiError.code === 'ECONNABORTED' || apiError.response?.status === 504 || apiError.response?.status === 500) {
                setWallet({
                  id: '',
                  userId: user.id,
                  channelId: channelInfo.id,
                  balance: 0,
                });
              }
              // Don't show error for wallet - it's not critical for page display
            }
          }
        }
      } catch (error: unknown) {
        const apiError = error as { response?: { status?: number; data?: { error?: string; errorCode?: string } } };
        const status = apiError.response?.status;
        const errorCode = apiError.response?.data?.errorCode;
        if (!isAuthed && status === 401) {
          setChannelLoadError('auth_required');
        } else if (status === 403 && errorCode === 'BETA_ACCESS_REQUIRED') {
          setChannelLoadError('beta_required');
        } else if (status === 403) {
          setChannelLoadError('forbidden');
        } else if (status === 404) {
          setChannelLoadError('not_found');
        } else {
          setChannelLoadError('failed');
          toast.error(apiError.response?.data?.error || t('toast.failedToLoadChannel'));
        }
        setLoading(false);
        setMemesLoading(false);
      }
    };

    loadChannelData();
  }, [slug, normalizedSlug, user, navigate, t, dispatch, isAuthed, reloadNonce]);

  const refreshWallet = useCallback(async () => {
    if (!user || !channelInfo?.slug) return;
    try {
      const w = await api.get<Wallet>(`/channels/${channelInfo.slug}/wallet`, { timeout: 10000 });
      setWallet(w);
      dispatch(updateWalletBalance({ channelId: w.channelId, balance: w.balance }));
    } catch {
      // ignore
    }
  }, [channelInfo?.slug, dispatch, user]);

  // Realtime: submissions status updates (Socket.IO)
  useEffect(() => {
    if (!socket || !isConnected) return;
    const roomSlug = String(channelInfo?.slug || normalizedSlug || '').trim();
    if (!roomSlug) return;

    socket.emit('join:channel', roomSlug.toLowerCase());

    const onStatus = (payload: { enabled?: boolean; onlyWhenLive?: boolean } | null | undefined) => {
      const enabled = typeof payload?.enabled === 'boolean' ? payload.enabled : null;
      const onlyWhenLive = typeof payload?.onlyWhenLive === 'boolean' ? payload.onlyWhenLive : null;
      if (enabled === null && onlyWhenLive === null) return;

      setChannelInfo((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          ...(enabled !== null ? { submissionsEnabled: enabled } : null),
          ...(onlyWhenLive !== null ? { submissionsOnlyWhenLive: onlyWhenLive } : null),
        };
      });

      if (enabled === false) {
        setIsSubmitModalOpen(false);
      }
    };

    socket.on('submissions:status', onStatus);
    return () => {
      socket.off('submissions:status', onStatus);
    };
  }, [channelInfo?.slug, isConnected, normalizedSlug, socket]);

  // Sync wallet from user.wallets when Redux store updates (e.g., via Socket.IO)
  useEffect(() => {
    if (user?.wallets && channelInfo) {
      const userWallet = user.wallets.find(w => w.channelId === channelInfo.id);
      if (userWallet && (!wallet || userWallet.balance !== wallet.balance)) {
        setWallet(userWallet);
      }
    }
  }, [user?.wallets, channelInfo, wallet]);

  // Load more memes function
  const loadMoreMemes = useCallback(async () => {
    if (!channelInfo || loadingMore || !hasMore || searchQuery.trim()) {
      return;
    }

    setLoadingMore(true);
    try {
      const nextOffset = memesOffset + MEMES_PER_PAGE;
      const canIncludeFileHash = !!(user && (user.role === 'admin' || user.channelId === channelInfo.id));
      const listParams = new URLSearchParams();
      listParams.set('channelSlug', String(channelInfo.slug || normalizedSlug).toLowerCase());
      listParams.set('limit', String(MEMES_PER_PAGE));
      listParams.set('offset', String(nextOffset));
      listParams.set('sortBy', 'createdAt');
      listParams.set('sortOrder', 'desc');
      if (canIncludeFileHash) listParams.set('includeFileHash', '1');
      listParams.set('_ts', String(Date.now()));

      let resp: unknown;
      try {
        resp = await fetchChannelMemesSearch({
          channelSlug: String(channelInfo.slug || normalizedSlug).toLowerCase(),
          params: listParams,
          preferPublic: channelInfo.memeCatalogMode === 'pool_all',
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
      const newMemes = Array.isArray(resp) ? (resp as Meme[]) : [];
      
      if (newMemes.length > 0) {
        setMemes(prev => [...prev, ...newMemes]);
        setMemesOffset(nextOffset);
        setHasMore(newMemes.length === MEMES_PER_PAGE);
      } else {
        setHasMore(false);
      }
    } catch (error) {
      setHasMore(false);
    } finally {
      setLoadingMore(false);
    }
  }, [channelInfo, loadingMore, hasMore, searchQuery, memesOffset, user, normalizedSlug]);

  // Intersection Observer for infinite scroll
  useEffect(() => {
    if (!loadMoreRef.current || searchQuery.trim() || !channelInfo?.id) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loadingMore && !memesLoading) {
          loadMoreMemes();
        }
      },
      { threshold: 0.1 }
    );

    const currentRef = loadMoreRef.current;
    observer.observe(currentRef);

    return () => {
      observer.disconnect();
    };
  }, [hasMore, loadingMore, memesLoading, searchQuery, channelInfo?.id, loadMoreMemes]);

  // Perform search when debounced query changes
  useEffect(() => {
    if (!normalizedSlug || (!debouncedSearchQuery.trim() && !myFavorites)) {
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
        params.set('limit', '100');
        params.set('sortBy', 'createdAt');
        params.set('sortOrder', 'desc');

        let memesResp: unknown;
        if (myFavorites) {
          memesResp = await api.get<unknown>(`/channels/memes/search?${(() => {
            const p = new URLSearchParams(params);
            p.set('channelSlug', normalizedSlug);
            p.set('favorites', '1');
            return p.toString();
          })()}`);
        } else {
          const searchParams = new URLSearchParams(params);
          if (channelInfo?.slug || normalizedSlug) {
            searchParams.set('channelSlug', String(channelInfo?.slug || normalizedSlug).toLowerCase());
          } else if (channelInfo?.id) {
            // Back-compat only.
            searchParams.set('channelId', channelInfo.id);
          }
          // Avoid stale cache after recent toggles.
          searchParams.set('_ts', String(Date.now()));

          try {
            memesResp = await fetchChannelMemesSearch({
              channelSlug: String(channelInfo?.slug || normalizedSlug).toLowerCase(),
              params: searchParams,
              preferPublic: channelInfo?.memeCatalogMode === 'pool_all',
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
        const memes = Array.isArray(memesResp) ? (memesResp as Meme[]) : [];
        setSearchResults(memes);
      } catch (error: unknown) {
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    };

    performSearch();
  }, [channelInfo?.id, debouncedSearchQuery, normalizedSlug, myFavorites, isAuthed]);

  const handleActivate = async (memeId: string): Promise<void> => {
    if (!user) {
      setAuthModalOpen(true);
      return;
    }

    try {
      const mode = channelInfo?.memeCatalogMode;
      await dispatch(
        activateMeme(
          mode === 'pool_all'
            ? { id: memeId, channelSlug: channelInfo?.slug || normalizedSlug }
            : { id: memeId },
        ),
      ).unwrap();
      toast.success(t('toast.memeActivated'));
      
      // Wallet balance will be updated via Socket.IO automatically
      // Sync from Redux store if available
      if (user?.wallets && channelInfo) {
        const userWallet = user.wallets.find(w => w.channelId === channelInfo.id);
        if (userWallet) {
          setWallet(userWallet);
        }
      }
    } catch (error: unknown) {
      const apiError = error as { message?: string };
      toast.error(apiError.message || t('toast.failedToActivate'));
    }
  };


  // Show error state when channel info didn't load
  if (!loading && !channelInfo) {
    const isBetaRequired = channelLoadError === 'beta_required';
    const isBetaHost = window.location.hostname.toLowerCase().includes('beta.');
    const openProduction = () => {
      try {
        if (!isBetaHost) return;
        const origin = window.location.origin;
        const prodOrigin = origin.replace('//beta.', '//');
        window.location.href = `${prodOrigin}/channel/${normalizedSlug}`;
      } catch {
        // ignore
      }
    };
    return (
      <PageShell header={<Header />}>
        <div className="min-h-[50vh] flex items-center justify-center px-4">
          <div className="surface p-6 max-w-md w-full text-center">
            <div className="text-lg font-semibold text-gray-900 dark:text-white">
              {channelLoadError === 'auth_required'
                ? t('profile.authRequiredTitle', { defaultValue: 'Login required' })
                : isBetaRequired
                  ? t('betaAccess.title', { defaultValue: 'Beta access required' })
                : channelLoadError === 'forbidden'
                  ? t('profile.accessDeniedTitle', { defaultValue: 'Access denied' })
                  : channelLoadError === 'failed'
                    ? t('profile.failedToLoadTitle', { defaultValue: 'Failed to load channel' })
                    : t('profile.channelNotFoundTitle', { defaultValue: 'Channel not found' })}
            </div>
            <div className="mt-2 text-sm text-gray-600 dark:text-gray-400">
              {channelLoadError === 'auth_required'
                ? t('profile.authRequiredHint', { defaultValue: 'Please log in to view this channel.' })
                : isBetaRequired
                  ? t('betaAccess.pageDescription', {
                      defaultValue: 'Beta is for testing new features. You can request access below.',
                    })
                : channelLoadError === 'forbidden'
                  ? t('profile.accessDeniedHint', { defaultValue: 'You do not have access to view this channel.' })
                  : channelLoadError === 'failed'
                    ? t('profile.failedToLoadHint', { defaultValue: 'Please retry. If the problem persists, try again later.' })
                    : t('profile.channelNotFoundHint', { defaultValue: 'The link may be wrong, or the channel was removed.' })}
            </div>
            <div className="mt-5 flex justify-center gap-2">
              {channelLoadError === 'auth_required' ? (
                <Button type="button" variant="primary" onClick={() => login(`/channel/${normalizedSlug}`)}>
                  {t('auth.login', { defaultValue: 'Log in with Twitch' })}
                </Button>
              ) : isBetaRequired ? (
                <Button
                  type="button"
                  variant="primary"
                  onClick={() => {
                    if (!user) {
                      login('/beta-access');
                      return;
                    }
                    navigate('/beta-access');
                  }}
                >
                  {t('betaAccess.requestButton', { defaultValue: 'Request beta access' })}
                </Button>
              ) : null}
              {isBetaRequired && isBetaHost ? (
                <Button type="button" variant="secondary" onClick={openProduction}>
                  {t('betaAccess.openProductionButton', { defaultValue: 'Open production' })}
                </Button>
              ) : null}
              <Button type="button" variant="secondary" onClick={() => setReloadNonce((n) => n + 1)}>
                {t('common.retry', { defaultValue: 'Retry' })}
              </Button>
              <Button type="button" variant="secondary" onClick={() => navigate('/')}>
                {t('common.goHome', { defaultValue: 'Go home' })}
              </Button>
            </div>
          </div>
        </div>
      </PageShell>
    );
  }

  // Check if current user is the owner of this channel
  const isOwner = !!(user && channelInfo && user.channelId === channelInfo.id);

  // Show page structure immediately, even if channel info is still loading
  return (
    <ChannelThemeProvider
      channelSlug={slug || ''}
      primaryColor={channelInfo?.primaryColor}
      secondaryColor={channelInfo?.secondaryColor}
      accentColor={channelInfo?.accentColor}
    >
      <PageShell
        variant="channel"
        className="overflow-hidden"
        background={
          <div
            aria-hidden="true"
            className="pointer-events-none fixed inset-0"
            style={{
              backgroundImage: [
                `radial-gradient(70% 60% at 18% 14%, ${mix('--primary-color', 18)} 0%, transparent 60%)`,
                `radial-gradient(60% 55% at 82% 18%, ${mix('--secondary-color', 16)} 0%, transparent 62%)`,
                `radial-gradient(70% 60% at 55% 88%, ${mix('--accent-color', 14)} 0%, transparent 62%)`,
                `linear-gradient(135deg, ${mix('--primary-color', 10)} 0%, transparent 45%, ${mix('--secondary-color', 10)} 100%)`,
              ].join(', '),
            }}
          />
        }
        header={
          <Header
            coinIconUrl={channelInfo?.coinIconUrl}
            channelSlug={slug}
            channelId={channelInfo?.id}
            primaryColor={channelInfo?.primaryColor}
            rewardTitle={channelInfo?.rewardTitle || null}
          />
        }
      >
        {/* Channel Header */}
        {loading ? (
          <div
            className="mb-8 pb-6"
          >
            <div className="flex items-center gap-4">
              <div className="w-20 h-20 rounded-lg bg-gray-200 dark:bg-gray-700 animate-pulse" />
              <div>
                <div className="h-8 w-48 bg-gray-200 dark:bg-gray-700 rounded animate-pulse mb-2" />
                <div className="h-4 w-32 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
              </div>
            </div>
          </div>
        ) : channelInfo && (
          <div
            className="mb-8 pb-6"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                {/* Avatar */}
                {(() => {
                  const rawUrl = (isOwner ? (user?.profileImageUrl || channelInfo.owner?.profileImageUrl) : channelInfo.owner?.profileImageUrl) || '';
                  const normalized = rawUrl.trim();
                  if (!normalized) return null;
                  const resolved = resolveMediaUrl(normalized);

                  return (
                    <img
                      src={resolved}
                      alt={channelInfo.owner?.displayName || channelInfo.name}
                      className="w-20 h-20 rounded-lg object-cover"
                      loading="lazy"
                    />
                  );
                })() || (
                  <div
                    className="w-20 h-20 rounded-lg bg-primary flex items-center justify-center text-white font-bold text-2xl"
                  >
                    {channelInfo.name.charAt(0).toUpperCase()}
                  </div>
                )}
                <div>
                  <div className="flex items-center gap-2">
                    <h1 className="text-4xl font-bold mb-2 dark:text-white">{channelInfo.name}</h1>
                  </div>
                  <div className="mt-4 flex gap-4 text-sm">
                    <Pill
                      variant="neutral"
                      size="sm"
                      className="ring-0 px-3 py-1 text-accent"
                      style={{ backgroundColor: mix('--accent-color', 14) }}
                    >
                      {channelInfo.stats.memesCount} {t('profile.memes')}
                    </Pill>
                    <Pill
                      variant="neutral"
                      size="sm"
                      className="ring-0 px-3 py-1 text-secondary"
                      style={{ backgroundColor: mix('--secondary-color', 14) }}
                    >
                      {channelInfo.stats.usersCount} {t('profile.users', { defaultValue: 'users' })}
                    </Pill>
                  </div>
                </div>
              </div>
              {/* Submit Meme Button - only show when logged in and not owner */}
              {user && !isOwner && (
                <div className="flex flex-col items-end gap-2">
                  {channelInfo?.youtubeLikeRewardEnabled && (channelInfo.youtubeLikeRewardCoins ?? 0) > 0 && (
                    <YouTubeLikeClaimButton
                      channelSlug={channelInfo.slug}
                      coins={channelInfo.youtubeLikeRewardCoins ?? 0}
                      onAwarded={() => void refreshWallet()}
                    />
                  )}
                  <HelpTooltip
                    content={
                      channelInfo?.submissionsEnabled === false
                        ? t('submitModal.submissionsDisabled', { defaultValue: 'Отправка мемов запрещена стримером' })
                        : t('help.profile.submitMeme', { defaultValue: 'Submit a meme to this channel.' })
                    }
                  >
                    <Button
                      type="button"
                      variant="primary"
                      disabled={channelInfo?.submissionsEnabled === false}
                      onClick={() => {
                        if (channelInfo?.submissionsEnabled === false) return;
                        setIsSubmitModalOpen(true);
                      }}
                      leftIcon={
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                      }
                    >
                      {t('profile.submitMeme')}
                    </Button>
                  </HelpTooltip>
                </div>
              )}

              {/* Guest CTA */}
              {!user && (
                <HelpTooltip content={t('help.profile.loginToInteract', { defaultValue: 'Log in to submit memes and use favorites.' })}>
                  <Button type="button" variant="secondary" className="glass-btn" onClick={() => setAuthModalOpen(true)}>
                    {t('auth.login', 'Log in with Twitch')}
                  </Button>
                </HelpTooltip>
              )}
            </div>
          </div>
        )}

        {/* Search Bar */}
        <div className="mb-6">
          <div className="relative">
            <Input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('search.placeholder') || 'Search memes...'}
              className="w-full px-4 py-2 pl-10 pr-12 bg-white/70 dark:bg-gray-900/60 border"
              style={{ borderColor: mix('--secondary-color', 28) }}
            />
            <svg
              className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            {searchQuery && (
              <IconButton
                type="button"
                variant="ghost"
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                aria-label={t('common.clear', { defaultValue: 'Clear' })}
                icon={
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                }
              />
            )}
          </div>
          <div className="mt-2 text-xs text-gray-600 dark:text-gray-400">
            {t('search.aiHint', { defaultValue: 'Search includes tags and hidden AI description.' })}
          </div>

          <div className="mt-3 flex items-center gap-3 flex-wrap">
            <HelpTooltip
              content={
                isAuthed
                  ? t('help.profile.favorites', { defaultValue: 'Show only your favorite memes.' })
                  : t('help.profile.loginToUseFavorites', { defaultValue: 'Log in to use favorites.' })
              }
            >
              <button
                type="button"
                className={`inline-flex items-center gap-2 text-sm rounded-full px-4 py-2 border shadow-sm transition-colors select-none ${
                  !isAuthed
                    ? 'opacity-60 cursor-not-allowed bg-white/60 dark:bg-gray-900/40 border-gray-200/60 dark:border-white/10 text-gray-500 dark:text-gray-400'
                    : myFavorites
                      ? 'bg-white/80 dark:bg-gray-900/60 border-accent/30 text-accent'
                      : 'bg-white/70 dark:bg-gray-900/40 border-gray-200/60 dark:border-white/10 text-gray-700 dark:text-gray-200 hover:bg-white/80 dark:hover:bg-white/10'
                }`}
                onClick={() => {
                  if (!isAuthed) {
                    setAuthModalOpen(true);
                    return;
                  }
                  setMyFavorites((v) => !v);
                }}
                aria-pressed={myFavorites}
              >
              <svg
                className={`w-4 h-4 ${myFavorites ? 'text-accent' : 'text-gray-500 dark:text-gray-300'}`}
                viewBox="0 0 24 24"
                fill={myFavorites ? 'currentColor' : 'none'}
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 21s-7-4.535-9.5-8.5C.5 9.5 2.5 6 6.5 6c2.04 0 3.57 1.1 4.5 2.2C11.93 7.1 13.46 6 15.5 6c4 0 6 3.5 4 6.5C19 16.465 12 21 12 21z"
                />
              </svg>
              {t('search.myFavorites', 'My favorites')}
              </button>
            </HelpTooltip>
          </div>

          {searchQuery && (
            <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
              {isSearching ? t('search.searching') || 'Searching...' : 
               searchResults.length > 0 
                 ? `${searchResults.length} ${t('search.resultsFound') || 'results found'}` 
                 : t('search.noResults') || 'No results found'}
            </p>
          )}
        </div>

        {/* Memes List */}
        <h2 className="text-2xl font-bold mb-4 dark:text-white">{t('profile.availableMemes')}</h2>
        {(() => {
          // If favorites is enabled, we always render searchResults (even with empty query).
          // Otherwise, only render searchResults when user is actually searching.
          const memesToDisplay = (myFavorites || searchQuery.trim()) ? searchResults : memes;
          
          if (memesLoading && !searchQuery.trim()) {
            return (
              <div className="columns-2 md:columns-3 lg:columns-4 xl:columns-5 gap-0" style={{ columnGap: 0 }}>
                {[...Array(6)].map((_, i) => (
                  <div key={i} className="mb-2 bg-gray-200 dark:bg-gray-700 rounded animate-pulse aspect-video" />
                ))}
              </div>
            );
          }
          
          if (memesToDisplay.length === 0 && !memesLoading) {
            return (
              <div className="surface p-6 text-center">
                <div className="text-base font-semibold text-gray-900 dark:text-white">
                  {searchQuery.trim()
                    ? t('search.noResults', { defaultValue: 'No memes found matching your criteria' })
                    : t('profile.noMemes', { defaultValue: 'No memes yet' })}
                </div>
                {searchQuery.trim() && (
                  <div className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                    {t('search.tryAdjusting', { defaultValue: 'Try changing filters or removing some tags.' })}
                  </div>
                )}
              </div>
            );
          }
          
          return (
            <>
              <div 
                className="meme-masonry"
              >
                {memesToDisplay.map((meme: Meme) => (
                  <MemeCard
                    key={getMemePrimaryId(meme)}
                    meme={meme}
                    onClick={() => {
                      setSelectedMeme(meme);
                      setIsModalOpen(true);
                    }}
                    isOwner={isOwner}
                    previewMode={autoplayMemesEnabled ? 'autoplayMuted' : 'hoverMuted'}
                  />
                ))}
              </div>
              {/* Infinite scroll trigger and loading indicator */}
              {!searchQuery.trim() && (
                <div ref={loadMoreRef} className="mt-4">
                  {loadingMore && (
                    <div className="flex items-center justify-center gap-3 py-4 text-gray-600 dark:text-gray-300">
                      <Spinner className="h-5 w-5" />
                      <span>{t('common.loading', { defaultValue: 'Loading…' })}</span>
                    </div>
                  )}
                  {!hasMore && memes.length > 0 && (
                    <div className="text-center py-4 text-gray-500 dark:text-gray-400">
                      {t('profile.allMemesLoaded', { defaultValue: 'All memes loaded' })}
                    </div>
                  )}
                </div>
              )}
            </>
          );
        })()}

      </PageShell>

      {/* Meme Modal */}
      {isModalOpen && selectedMeme && (
        <MemeModal
          meme={selectedMeme}
          isOpen={isModalOpen}
          onClose={() => {
            setIsModalOpen(false);
            setSelectedMeme(null);
          }}
          onUpdate={() => {
            // Wallet will be updated via Socket.IO automatically
            // Sync from Redux store if available
            if (user?.wallets && channelInfo) {
              const userWallet = user.wallets.find(w => w.channelId === channelInfo.id);
              if (userWallet) {
                setWallet(userWallet);
              }
            }
          }}
          isOwner={isOwner}
          mode="viewer"
          onActivate={handleActivate}
          walletBalance={wallet?.balance}
        />
      )}

      {/* Submit Modal */}
      <SubmitModal
        isOpen={isSubmitModalOpen}
        onClose={() => setIsSubmitModalOpen(false)}
        channelSlug={slug}
        channelId={channelInfo?.id}
        initialBlockedReason={channelInfo?.submissionsEnabled === false ? 'disabled' : null}
      />

      {/* Coins Info Modal */}
      {channelInfo && <CoinsInfoModal rewardTitle={channelInfo.rewardTitle || null} />}

      <AuthRequiredModal
        isOpen={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
        onCtaClick={() => {
          setAuthModalOpen(false);
          login(`/channel/${normalizedSlug || slug || ''}`);
        }}
      />
    </ChannelThemeProvider>
  );
}


