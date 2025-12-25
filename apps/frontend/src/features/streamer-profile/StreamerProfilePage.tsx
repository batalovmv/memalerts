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
import SubmitModal from '@/components/SubmitModal';

import { api } from '@/lib/api';
import { login } from '@/lib/auth';
import { resolveMediaUrl } from '@/lib/urls';

import { useDebounce } from '@/hooks/useDebounce';
import { useAutoplayMemes } from '@/hooks/useAutoplayMemes';

import { useAppSelector, useAppDispatch } from '@/store/hooks';
import { updateWalletBalance } from '@/store/slices/authSlice';
import { activateMeme } from '@/store/slices/memesSlice';

interface ChannelInfo {
  id: string;
  slug: string;
  name: string;
  coinPerPointRatio: number;
  coinIconUrl?: string | null;
  rewardTitle?: string | null;
  primaryColor?: string | null;
  secondaryColor?: string | null;
  accentColor?: string | null;
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

export default function StreamerProfile() {
  const { t } = useTranslation();
  const { slug } = useParams<{ slug: string }>();
  const { user } = useAppSelector((state) => state.auth);
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  
  const [channelInfo, setChannelInfo] = useState<ChannelInfo | null>(null);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [loading, setLoading] = useState(true);
  const [memes, setMemes] = useState<Meme[]>([]);
  const [memesLoading, setMemesLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [memesOffset, setMemesOffset] = useState(0);
  const MEMES_PER_PAGE = 30;
  const [selectedMeme, setSelectedMeme] = useState<Meme | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSubmitModalOpen, setIsSubmitModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [myFavorites, setMyFavorites] = useState(false);
  const [authModalOpen, setAuthModalOpen] = useState(false);

  // Remove deleted memes immediately (no refresh) when streamer deletes from dashboard.
  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ memeId?: string }>;
      const memeId = ce.detail?.memeId;
      if (!memeId) return;
      setMemes((prev) => prev.filter((m) => m.id !== memeId));
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

    const loadChannelData = async () => {
      try {
        // Load channel info without memes for faster initial load
        const channelInfo = await api.get<ChannelInfo>(`/channels/${normalizedSlug}?includeMemes=false`, {
          timeout: 15000, // 15 seconds timeout
        });
        setChannelInfo({ ...channelInfo, memes: [] }); // Set memes to empty array initially
        setLoading(false); // Channel info loaded, can show page structure

        // Canonicalize URL (prevents case-sensitive slug issues on production)
        if (slug && channelInfo.slug && slug !== channelInfo.slug) {
          navigate(`/channel/${channelInfo.slug}`, { replace: true });
        }
        
        // Load memes separately with pagination
        setMemesLoading(true);
        setMemesOffset(0);
        try {
          const memes = await api.get<Meme[]>(`/channels/${channelInfo.slug}/memes?limit=${MEMES_PER_PAGE}&offset=0`, {
            timeout: 15000, // 15 seconds timeout
          });
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
        const apiError = error as { response?: { status?: number; data?: { error?: string } } };
        if (apiError.response?.status === 404) {
          toast.error(t('toast.channelNotFound'));
          navigate('/');
        } else {
          toast.error(apiError.response?.data?.error || t('toast.failedToLoadChannel'));
        }
        setLoading(false);
        setMemesLoading(false);
      }
    };

    loadChannelData();
  }, [slug, normalizedSlug, user, navigate, t, dispatch]);

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
      const newMemes = await api.get<Meme[]>(`/channels/${channelInfo.slug}/memes?limit=${MEMES_PER_PAGE}&offset=${nextOffset}`, {
        timeout: 15000, // 15 seconds timeout
      });
      
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
  }, [channelInfo, loadingMore, hasMore, searchQuery, memesOffset]);

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
        const params = new URLSearchParams();
        if (debouncedSearchQuery.trim()) params.set('q', debouncedSearchQuery.trim());
        params.set('channelSlug', normalizedSlug);
        params.set('limit', '100');
        if (myFavorites) params.set('favorites', '1');
        params.set('sortBy', 'createdAt');
        params.set('sortOrder', 'desc');
        const memes = await api.get<Meme[]>(`/channels/memes/search?${params.toString()}`);
        setSearchResults(memes);
      } catch (error: unknown) {
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    };

    performSearch();
  }, [debouncedSearchQuery, normalizedSlug, myFavorites]);

  const handleActivate = async (memeId: string): Promise<void> => {
    if (!user) {
      setAuthModalOpen(true);
      return;
    }

    try {
      await dispatch(activateMeme(memeId)).unwrap();
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


  // Show error state if channel not found
  if (!loading && !channelInfo) {
    return (
      <div className="min-h-screen bg-gray-100 dark:bg-gray-900">
        <Header />
        <div className="min-h-screen flex items-center justify-center">
          <div className="text-xl text-red-600">Channel not found</div>
        </div>
      </div>
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
      <div className="min-h-screen bg-gray-100 dark:bg-gray-900 relative overflow-hidden">
        {/* Apple-ish theme background using all 3 channel colors */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage: [
              `radial-gradient(70% 60% at 18% 14%, ${mix('--primary-color', 18)} 0%, transparent 60%)`,
              `radial-gradient(60% 55% at 82% 18%, ${mix('--secondary-color', 16)} 0%, transparent 62%)`,
              `radial-gradient(70% 60% at 55% 88%, ${mix('--accent-color', 14)} 0%, transparent 62%)`,
              `linear-gradient(135deg, ${mix('--primary-color', 10)} 0%, transparent 45%, ${mix('--secondary-color', 10)} 100%)`,
            ].join(', '),
          }}
        />
        <Header
          coinIconUrl={channelInfo?.coinIconUrl} 
          channelSlug={slug}
          channelId={channelInfo?.id}
          primaryColor={channelInfo?.primaryColor}
          rewardTitle={channelInfo?.rewardTitle || null}
        />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
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
                    <span
                      className="inline-flex items-center rounded-full px-3 py-1 text-accent font-semibold"
                      style={{ backgroundColor: mix('--accent-color', 14) }}
                    >
                      {channelInfo.stats.memesCount} {t('profile.memes')}
                    </span>
                    <span
                      className="inline-flex items-center rounded-full px-3 py-1 text-secondary font-semibold"
                      style={{ backgroundColor: mix('--secondary-color', 14) }}
                    >
                      {channelInfo.stats.usersCount} {t('profile.users', { defaultValue: 'users' })}
                    </span>
                  </div>
                </div>
              </div>
              {/* Submit Meme Button - only show when logged in and not owner */}
              {user && !isOwner && (
                <button
                  onClick={() => setIsSubmitModalOpen(true)}
                  className="flex items-center gap-2 bg-primary hover:bg-secondary text-white font-semibold py-2 px-4 rounded-lg transition-colors shadow-sm"
                  title={t('profile.submitMeme')}
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  <span>{t('profile.submitMeme')}</span>
                </button>
              )}

              {/* Guest CTA */}
              {!user && (
                <button
                  onClick={() => setAuthModalOpen(true)}
                  className="flex items-center gap-2 glass-btn px-4 py-2 text-sm font-semibold text-gray-900 dark:text-white"
                  title={t('auth.loginToInteract', 'Log in to submit memes and use favorites')}
                >
                  {t('auth.login', 'Log in with Twitch')}
                </button>
              )}
            </div>
          </div>
        )}

        {/* Search Bar */}
        <div className="mb-6">
          <div className="relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('search.placeholder') || 'Search memes...'}
              className="w-full rounded-lg px-4 py-2 pl-10 bg-white/70 dark:bg-gray-900/60 text-gray-900 dark:text-white shadow-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary-color)] border"
              style={{ borderColor: mix('--secondary-color', 28) }}
            />
            <svg
              className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                aria-label="Clear search"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>

          <div className="mt-3 flex items-center gap-3 flex-wrap">
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
              title={isAuthed ? '' : t('auth.loginToUseFavorites', 'Log in to use favorites')}
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
              <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                {searchQuery.trim() ? (t('search.noResults') || 'No memes found') : t('profile.noMemes')}
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
                    key={meme.id}
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
                    <div className="text-center py-4 text-gray-500 dark:text-gray-400">
                      {t('common.loading') || 'Loading more memes...'}
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
      </main>

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
      </div>
    </ChannelThemeProvider>
  );
}


