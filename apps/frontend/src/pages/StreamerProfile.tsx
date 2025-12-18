import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAppSelector, useAppDispatch } from '../store/hooks';
import { activateMeme } from '../store/slices/memesSlice';
import { updateWalletBalance } from '../store/slices/authSlice';
import { api } from '../lib/api';
import Header from '../components/Header';
import MemeCard from '../components/MemeCard';
import MemeModal from '../components/MemeModal';
import SubmitModal from '../components/SubmitModal';
import CoinsInfoModal from '../components/CoinsInfoModal';
import toast from 'react-hot-toast';
import { useDebounce } from '../hooks/useDebounce';
import type { Meme, Wallet } from '../types';

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
  const [searchResults, setSearchResults] = useState<Meme[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  
  const debouncedSearchQuery = useDebounce(searchQuery, 500);

  useEffect(() => {
    if (!slug) {
      navigate('/');
      return;
    }

    const loadChannelData = async () => {
      try {
        // Load channel info without memes for faster initial load
        const channelInfo = await api.get<ChannelInfo>(`/channels/${slug}?includeMemes=false`, {
          timeout: 15000, // 15 seconds timeout
        });
        setChannelInfo({ ...channelInfo, memes: [] }); // Set memes to empty array initially
        setLoading(false); // Channel info loaded, can show page structure
        
        // Load memes separately with pagination
        setMemesLoading(true);
        setMemesOffset(0);
        try {
          const memes = await api.get<Meme[]>(`/memes?channelId=${channelInfo.id}&limit=${MEMES_PER_PAGE}&offset=0`, {
            timeout: 15000, // 15 seconds timeout
          });
          setMemes(memes);
          setHasMore(memes.length === MEMES_PER_PAGE);
        } catch (error) {
          console.error('Error loading memes:', error);
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
              const wallet = await api.get<Wallet>(`/channels/${slug}/wallet`, {
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
              console.warn('Failed to load wallet:', error);
            }
          }
        }
      } catch (error: unknown) {
        const apiError = error as { response?: { status?: number; data?: { error?: string } } };
        console.error('Error loading channel:', error);
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
  }, [slug, user, navigate, t, dispatch]);

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
      const newMemes = await api.get<Meme[]>(`/memes?channelId=${channelInfo.id}&limit=${MEMES_PER_PAGE}&offset=${nextOffset}`, {
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
      console.error('Error loading more memes:', error);
      setHasMore(false);
    } finally {
      setLoadingMore(false);
    }
  }, [channelInfo, loadingMore, hasMore, searchQuery, memesOffset]);

  // Intersection Observer for infinite scroll
  useEffect(() => {
    if (!loadMoreRef.current || searchQuery.trim() || !channelInfo) {
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
    if (!slug || !debouncedSearchQuery.trim()) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    const performSearch = async () => {
      setIsSearching(true);
      try {
        const params = new URLSearchParams({
          q: debouncedSearchQuery,
          channelSlug: slug,
          limit: '100',
        });
        const memes = await api.get<Meme[]>(`/channels/memes/search?${params.toString()}`);
        setSearchResults(memes);
      } catch (error: unknown) {
        console.error('Search failed:', error);
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    };

    performSearch();
  }, [debouncedSearchQuery, slug]);

  const handleActivate = async (memeId: string): Promise<void> => {
    if (!user) {
      toast.error(t('toast.pleaseLogInToActivate'));
      navigate('/');
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

  // Apply custom colors if available
  const customStyles: Record<string, string> = {};
  if (channelInfo?.primaryColor) {
    customStyles['--primary-color'] = channelInfo.primaryColor;
  }
  if (channelInfo?.secondaryColor) {
    customStyles['--secondary-color'] = channelInfo.secondaryColor;
  }
  if (channelInfo?.accentColor) {
    customStyles['--accent-color'] = channelInfo.accentColor;
  }

  // Show page structure immediately, even if channel info is still loading
  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900" style={customStyles}>
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
          <div className="mb-8 border-b border-secondary/30 pb-4">
            <div className="flex items-center gap-4">
              <div className="w-20 h-20 rounded-lg bg-gray-200 dark:bg-gray-700 animate-pulse" />
              <div>
                <div className="h-8 w-48 bg-gray-200 dark:bg-gray-700 rounded animate-pulse mb-2" />
                <div className="h-4 w-32 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
              </div>
            </div>
          </div>
        ) : channelInfo && (
          <div className="mb-8 border-b border-secondary/30 pb-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                {/* Avatar */}
                {channelInfo.owner?.profileImageUrl ? (
                  <img 
                    src={channelInfo.owner.profileImageUrl} 
                    alt={channelInfo.owner.displayName}
                    className="w-20 h-20 rounded-lg object-cover border-2 border-secondary/30"
                  />
                ) : (
                  <div className="w-20 h-20 rounded-lg bg-primary flex items-center justify-center text-white font-bold text-2xl border-2 border-secondary/30">
                    {channelInfo.name.charAt(0).toUpperCase()}
                  </div>
                )}
                <div>
                  <h1 className="text-4xl font-bold mb-2 dark:text-white">{channelInfo.name}</h1>
                  <div className="mt-4 flex gap-4 text-sm">
                    <span className="text-accent font-semibold">{channelInfo.stats.memesCount} {t('profile.memes')}</span>
                    <span className="text-accent font-semibold">{channelInfo.stats.usersCount} {t('profile.users')}</span>
                  </div>
                </div>
              </div>
              {/* Submit Meme Button - only show when logged in and not owner */}
              {user && !isOwner && (
                <button
                  onClick={() => setIsSubmitModalOpen(true)}
                  className="flex items-center gap-2 bg-primary hover:bg-secondary text-white font-semibold py-2 px-4 rounded-lg transition-colors border border-secondary/30"
                  title={t('profile.submitMeme')}
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  <span>{t('profile.submitMeme')}</span>
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
              className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 pl-10 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary"
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
          const memesToDisplay = searchQuery.trim() ? searchResults : memes;
          
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
                className="columns-2 md:columns-3 lg:columns-4 xl:columns-5 gap-0"
                style={{ columnGap: 0 }}
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
                    onActivate={handleActivate}
                    walletBalance={wallet?.balance}
                    canActivate={wallet ? wallet.balance >= meme.priceCoins : false}
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
                      {t('profile.allMemesLoaded') || 'All memes loaded'}
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
    </div>
  );
}

