import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';

import type { Meme } from '@/types';

import Header from '@/components/Header';
import { useSocket } from '@/contexts/SocketContext';
import { useStreamerProfileChannel } from '@/features/streamer-profile/model/useStreamerProfileChannel';
import { useStreamerProfileMemes } from '@/features/streamer-profile/model/useStreamerProfileMemes';
import { useStreamerProfilePersonalizedMemes } from '@/features/streamer-profile/model/useStreamerProfilePersonalizedMemes';
import { useStreamerProfileSubmissionsStatus } from '@/features/streamer-profile/model/useStreamerProfileSubmissionsStatus';
import { useStreamerProfileWallet } from '@/features/streamer-profile/model/useStreamerProfileWallet';
import { StreamerProfileErrorState } from '@/features/streamer-profile/ui/StreamerProfileErrorState';
import { StreamerProfileHeader } from '@/features/streamer-profile/ui/StreamerProfileHeader';
import { StreamerProfileMemesSection } from '@/features/streamer-profile/ui/StreamerProfileMemesSection';
import { StreamerProfileModals } from '@/features/streamer-profile/ui/StreamerProfileModals';
import { StreamerProfileSearch } from '@/features/streamer-profile/ui/StreamerProfileSearch';
import { login } from '@/lib/auth';
import ChannelThemeProvider from '@/shared/lib/ChannelThemeProvider';
import { useAutoplayMemes } from '@/shared/lib/hooks';
import { PageShell } from '@/shared/ui';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { activateMeme } from '@/store/slices/memesSlice';

type StreamerListMode = 'all' | 'favorites' | 'frequent' | 'recent' | 'hidden' | 'trending' | 'blocked' | 'forYou';
const AUTH_REQUIRED_LIST_MODES: StreamerListMode[] = ['favorites', 'forYou', 'hidden'];
const PUBLIC_LIST_MODES: StreamerListMode[] = ['forYou', 'all', 'favorites'];

const StreamerProfile = memo(function StreamerProfile() {
  const { t } = useTranslation();
  const { slug } = useParams<{ slug: string }>();
  const { user } = useAppSelector((state) => state.auth);
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { socket, isConnected } = useSocket();
  const [reloadNonce, setReloadNonce] = useState(0);
  const [selectedMeme, setSelectedMeme] = useState<Meme | null>(null);
  const [isMemeModalOpen, setIsMemeModalOpen] = useState(false);
  const [isSubmitModalOpen, setIsSubmitModalOpen] = useState(false);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [listMode, setListMode] = useState<StreamerListMode>('all');
  const [trendingScope, setTrendingScope] = useState<'channel' | 'global'>('channel');
  const [trendingPeriod, setTrendingPeriod] = useState<7 | 30>(7);

  const normalizedSlug = (slug || '').trim().toLowerCase();
  const isAuthed = !!user;
  const handleReloadChannel = useCallback(() => setReloadNonce((n) => n + 1), []);
  const handleOpenSubmitModal = useCallback(() => setIsSubmitModalOpen(true), []);
  const handleCloseSubmitModal = useCallback(() => setIsSubmitModalOpen(false), []);
  const handleOpenAuthModal = useCallback(() => setAuthModalOpen(true), []);
  const handleCloseAuthModal = useCallback(() => setAuthModalOpen(false), []);

  const { channelInfo, setChannelInfo, channelLoadError, loading } = useStreamerProfileChannel({
    slug,
    normalizedSlug,
    isAuthed,
    reloadNonce,
  });

  const { wallet, refreshWallet, syncWalletFromUser } = useStreamerProfileWallet({
    user,
    channelInfo,
    dispatch,
  });

  const { autoplayMemesEnabled } = useAutoplayMemes();

  const {
    memes,
    memesLoading,
    loadingMore,
    hasMore,
    loadMoreRef,
    searchQuery,
    setSearchQuery,
    tagFilter,
    setTagFilter,
    searchResults,
    isSearching,
    hasAiProcessing,
  } = useStreamerProfileMemes({
    channelInfo,
    normalizedSlug,
    user,
    reloadNonce,
    onReloadChannel: handleReloadChannel,
    listMode,
    trendingScope,
    trendingPeriod,
  });

  const availableTags = useMemo(() => {
    const counts = new Map<string, number>();
    const pushTag = (raw: unknown) => {
      if (typeof raw !== 'string') return;
      const trimmed = raw.trim();
      if (!trimmed) return;
      const key = trimmed.toLowerCase();
      counts.set(key, (counts.get(key) || 0) + 1);
    };
    memes.forEach((meme) => {
      if (Array.isArray(meme.aiAutoTagNames)) {
        meme.aiAutoTagNames.forEach((tag) => pushTag(tag));
      }
      if (Array.isArray(meme.tags)) {
        meme.tags.forEach((item) => pushTag(item?.tag?.name));
      }
    });
    return Array.from(counts.entries())
      .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))
      .map(([tag]) => tag);
  }, [memes]);

  const {
    memes: personalizedMemes,
    loading: personalizedLoading,
    profileReady,
    totalActivations,
    mode: personalizedMode,
  } = useStreamerProfilePersonalizedMemes({
    channelInfo,
    normalizedSlug,
    isAuthed,
    reloadNonce,
    limit: 60,
  });

  const isOwner = !!(user && channelInfo && user.channelId === channelInfo.id);
  const canViewBlocked = isAuthed && (user?.role === 'admin' || isOwner);

  useEffect(() => {
    if (!isAuthed && AUTH_REQUIRED_LIST_MODES.includes(listMode)) {
      setListMode('all');
    }
  }, [isAuthed, listMode]);

  useEffect(() => {
    if (PUBLIC_LIST_MODES.includes(listMode)) return;
    if (isAuthed && listMode === 'hidden') return;
    setListMode('all');
  }, [isAuthed, listMode]);

  useEffect(() => {
    if (listMode === 'blocked' && !canViewBlocked) {
      setListMode('all');
    }
  }, [canViewBlocked, listMode]);

  useEffect(() => {
    if (listMode === 'forYou' && searchQuery.trim()) {
      setListMode('all');
    }
  }, [listMode, searchQuery]);

  useStreamerProfileSubmissionsStatus({
    socket,
    isConnected,
    normalizedSlug,
    channelInfo,
    setChannelInfo,
    onCloseSubmitModal: handleCloseSubmitModal,
  });

  // Helpers: use CSS variables (set by ChannelThemeProvider) to build subtle tints safely.
  // We avoid Tailwind color opacity modifiers here because theme colors are CSS vars (hex), and
  // utilities like `border-secondary/30` may not render as expected with `var(--color)`.
  const mix = useCallback(
    (cssVar: '--primary-color' | '--secondary-color' | '--accent-color', percent: number) =>
      `color-mix(in srgb, var(${cssVar}) ${percent}%, transparent)`,
    [],
  );
  const channelBackgroundStyle = useMemo(
    () => ({
      backgroundImage: [
        `radial-gradient(70% 60% at 18% 14%, ${mix('--primary-color', 18)} 0%, transparent 60%)`,
        `radial-gradient(60% 55% at 82% 18%, ${mix('--secondary-color', 16)} 0%, transparent 62%)`,
        `radial-gradient(70% 60% at 55% 88%, ${mix('--accent-color', 14)} 0%, transparent 62%)`,
        `linear-gradient(135deg, ${mix('--primary-color', 10)} 0%, transparent 45%, ${mix('--secondary-color', 10)} 100%)`,
      ].join(', '),
    }),
    [mix],
  );

  const handleActivate = useCallback(
    async (memeId: string): Promise<void> => {
      if (!user) {
        setAuthModalOpen(true);
        return;
      }

      try {
        const mode = channelInfo?.memeCatalogMode;
        await dispatch(
          activateMeme(
            mode === 'pool_all'
              ? { id: memeId, channelId: channelInfo?.id || undefined }
              : { id: memeId },
          ),
        ).unwrap();
        toast.success(t('toast.memeActivated'));
        syncWalletFromUser();
      } catch (error: unknown) {
        const apiError = error as { message?: string };
        toast.error(apiError.message || t('toast.failedToActivate'));
      }
    },
    [channelInfo?.id, channelInfo?.memeCatalogMode, dispatch, syncWalletFromUser, t, user],
  );
  const handleLogin = useCallback(() => login(`/channel/${normalizedSlug}`), [normalizedSlug]);
  const handleRequestBeta = useCallback(() => {
    if (!user) {
      login('/beta-access');
      return;
    }
    navigate('/beta-access');
  }, [navigate, user]);
  const handleGoHome = useCallback(() => navigate('/'), [navigate]);
  const handleSelectMeme = useCallback((meme: Meme) => {
    setSelectedMeme(meme);
    setIsMemeModalOpen(true);
  }, []);
  const handleClearSearchQuery = useCallback(() => {
    setSearchQuery('');
    if (tagFilter.trim()) setTagFilter('');
  }, [setSearchQuery, setTagFilter, tagFilter]);
  const handleClearTagFilter = useCallback(() => setTagFilter(''), [setTagFilter]);
  const handleSearchQueryChange = useCallback(
    (next: string) => {
      if (tagFilter.trim()) {
        setTagFilter('');
      }
      setSearchQuery(next);
    },
    [setSearchQuery, setTagFilter, tagFilter],
  );
  const handleTagSelect = useCallback(
    (tag: string) => {
      setListMode('all');
      setTagFilter(tag);
      if (searchQuery.trim()) setSearchQuery('');
    },
    [searchQuery, setSearchQuery, setTagFilter],
  );
  const handleChangeListMode = useCallback(
    (nextMode: StreamerListMode) => {
      if (nextMode === 'forYou') {
        if (!isAuthed) {
          setAuthModalOpen(true);
          return;
        }
        setListMode('forYou');
        if (tagFilter.trim()) setTagFilter('');
        if (searchQuery.trim()) setSearchQuery('');
        return;
      }

      if (nextMode === 'blocked') {
        if (!canViewBlocked) {
          if (!isAuthed) setAuthModalOpen(true);
          return;
        }
        setListMode('blocked');
        return;
      }

      if (nextMode === 'favorites' || nextMode === 'hidden') {
        if (!isAuthed) {
          setAuthModalOpen(true);
          return;
        }
        setListMode(nextMode);
        return;
      }

      setListMode(nextMode);
    },
    [canViewBlocked, isAuthed, searchQuery, setSearchQuery, tagFilter, setTagFilter],
  );
  const handleTagSearch = useCallback(
    (tag: string) => {
      setListMode('all');
      setTagFilter(tag);
      setSearchQuery('');
      setIsMemeModalOpen(false);
      setSelectedMeme(null);
    },
    [setSearchQuery, setTagFilter],
  );
  const handleAuthCta = useCallback(() => {
    setAuthModalOpen(false);
    login(`/channel/${normalizedSlug || slug || ''}`);
  }, [normalizedSlug, slug]);
  const handleCloseMemeModal = useCallback(() => {
    setIsMemeModalOpen(false);
    setSelectedMeme(null);
  }, []);

  // Show error state when channel info didn't load
  if (!loading && !channelInfo) {
    return (
      <StreamerProfileErrorState
        error={channelLoadError || 'failed'}
        normalizedSlug={normalizedSlug}
        onLogin={handleLogin}
        onRequestBeta={handleRequestBeta}
        onRetry={handleReloadChannel}
        onGoHome={handleGoHome}
      />
    );
  }

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
            style={channelBackgroundStyle}
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
        <StreamerProfileHeader
          loading={loading}
          channelInfo={channelInfo}
          user={user}
          isOwner={isOwner}
          mix={mix}
          onOpenSubmit={handleOpenSubmitModal}
          onOpenAuthModal={handleOpenAuthModal}
          onRefreshWallet={refreshWallet}
        />

        <StreamerProfileSearch
          searchQuery={searchQuery}
          onChangeSearchQuery={handleSearchQueryChange}
          onClearSearchQuery={handleClearSearchQuery}
          tagFilter={tagFilter}
          onClearTagFilter={handleClearTagFilter}
          availableTags={availableTags}
          onSelectTag={handleTagSelect}
          isSearching={isSearching}
          searchResultsCount={searchResults.length}
          mix={mix}
        />
        <StreamerProfileMemesSection
          memes={memes}
          searchResults={searchResults}
          searchQuery={searchQuery}
          tagFilter={tagFilter}
          listMode={listMode}
          onChangeListMode={handleChangeListMode}
          trendingScope={trendingScope}
          trendingPeriod={trendingPeriod}
          onChangeTrendingScope={setTrendingScope}
          onChangeTrendingPeriod={setTrendingPeriod}
          isAuthed={isAuthed}
          onRequireAuth={handleOpenAuthModal}
          isSearching={isSearching}
          memesLoading={memesLoading}
          loadingMore={loadingMore}
          hasMore={hasMore}
          loadMoreRef={loadMoreRef}
          autoplayMemesEnabled={autoplayMemesEnabled}
          isOwner={isOwner}
          hasAiProcessing={hasAiProcessing}
          personalizedMemes={personalizedMemes}
          personalizedLoading={personalizedLoading}
          personalizedProfileReady={profileReady}
          personalizedTotalActivations={totalActivations}
          personalizedMode={personalizedMode}
          onSelectMeme={handleSelectMeme}
        />
      </PageShell>

      <StreamerProfileModals
        selectedMeme={selectedMeme}
        isMemeModalOpen={isMemeModalOpen}
        onCloseMemeModal={handleCloseMemeModal}
        onTagSearch={handleTagSearch}
        onMemeUpdate={syncWalletFromUser}
        onActivate={handleActivate}
        isOwner={isOwner}
        walletBalance={wallet?.balance}
        isSubmitModalOpen={isSubmitModalOpen}
        onCloseSubmitModal={handleCloseSubmitModal}
        channelSlug={slug}
        channelId={channelInfo?.id}
        listMode={listMode}
        submissionBlocked={channelInfo?.submissionsEnabled === false}
        showCoinsInfo={!!channelInfo}
        rewardTitle={channelInfo?.rewardTitle || null}
        authModalOpen={authModalOpen}
        onCloseAuthModal={handleCloseAuthModal}
        onAuthCta={handleAuthCta}
      />
    </ChannelThemeProvider>
  );
});

export default StreamerProfile;
