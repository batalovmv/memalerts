import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';

import type { MemePoolItem } from '@/shared/api/memesPool';
import type { Meme } from '@/types';

import Header from '@/components/Header';
import MemeCard from '@/components/MemeCard';
import { login } from '@/lib/auth';
import { resolveMediaUrl } from '@/lib/urls';
import { getMemesPool } from '@/shared/api/memesPool';
import { createPoolSubmission } from '@/shared/api/submissionsPool';
import { PageShell, Button, HelpTooltip, Input, Spinner } from '@/shared/ui';
import { Modal } from '@/shared/ui/Modal/Modal';
import ConfirmDialog from '@/shared/ui/modals/ConfirmDialog';
import { useAppSelector } from '@/store/hooks';

type PoolItem = MemePoolItem & { _raw?: unknown };

function getPoolMemeAssetId(m: PoolItem): string | null {
  // Backend may return `memeAssetId` explicitly. As a fallback, treat `id` as memeAssetId.
  if (typeof m.memeAssetId === 'string' && m.memeAssetId.trim()) return m.memeAssetId.trim();
  if (typeof m.id === 'string' && m.id.trim()) return m.id.trim();
  return null;
}

function toPoolCardMeme(m: PoolItem, fallbackTitle: string): Meme {
  // MemeCard expects Meme-like shape; pool items are MemeAsset-like (channel-independent).
  // Best-effort mapping with sensible fallbacks.
  const fileUrl =
    (typeof (m as unknown as { fileUrl?: unknown }).fileUrl === 'string' && (m as unknown as { fileUrl: string }).fileUrl) ||
    (typeof (m as unknown as { previewUrl?: unknown }).previewUrl === 'string' && (m as unknown as { previewUrl: string }).previewUrl) ||
    (typeof (m as unknown as { url?: unknown }).url === 'string' && (m as unknown as { url: string }).url) ||
    '';

  const title = (typeof m.sampleTitle === 'string' && m.sampleTitle.trim()) ? m.sampleTitle.trim() : fallbackTitle;
  const priceCoins = typeof m.samplePriceCoins === 'number' && Number.isFinite(m.samplePriceCoins) ? m.samplePriceCoins : 0;
  const durationMs = typeof m.durationMs === 'number' && Number.isFinite(m.durationMs) ? m.durationMs : 0;
  const type = (m.type as Meme['type'] | undefined) || 'video';

  return {
    id: String(m.id ?? ''),
    title,
    type,
    fileUrl,
    priceCoins,
    durationMs,
  };
}

export default function PoolPage() {
  const { t } = useTranslation();
  const { user } = useAppSelector((s) => s.auth);
  const isAuthed = !!user;
  const [authRequired, setAuthRequired] = useState(false);
  const [submittingAssetId, setSubmittingAssetId] = useState<string | null>(null);
  const [searchParams] = useSearchParams();
  const [selectedItem, setSelectedItem] = useState<PoolItem | null>(null);
  const [isMemeModalOpen, setIsMemeModalOpen] = useState(false);
  const PREVIEW_MUTED_STORAGE_KEY = 'memalerts.pool.previewMuted';
  const [previewMuted, setPreviewMuted] = useState<boolean>(() => {
    try {
      const raw = window.localStorage.getItem(PREVIEW_MUTED_STORAGE_KEY);
      if (raw === null) return false; // default: sound ON
      return raw === '1' || raw === 'true';
    } catch {
      return false;
    }
  });
  const previewVideoRef = useRef<HTMLVideoElement>(null);

  // When opened from a streamer public profile, SubmitModal can pass a target channel via query params.
  const targetChannelId = (searchParams.get('channelId') || '').trim() || null;
  const targetChannelSlug = (searchParams.get('channelSlug') || '').trim() || null;

  const isStreamer = !!user && (user.role === 'streamer' || user.role === 'admin') && !!user.channelId;
  const submitChannelId = targetChannelId || (isStreamer ? user?.channelId || null : null);
  const submitMode: 'viewerToStreamer' | 'streamerToOwn' | 'browseOnly' =
    targetChannelId ? 'viewerToStreamer' : isStreamer ? 'streamerToOwn' : 'browseOnly';

  const [q, setQ] = useState('');
  const [items, setItems] = useState<PoolItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const limit = 30;

  const [pendingAdd, setPendingAdd] = useState<null | { memeAssetId: string; title: string }>(null);
  const [pendingAddTitle, setPendingAddTitle] = useState('');

  const canLoadMore = useMemo(() => items.length === 0 || items.length % limit === 0, [items.length]);

  const loadPage = useCallback(
    async (nextOffset: number, append: boolean) => {
      try {
        setAuthRequired(false);
        const next = (await getMemesPool({ q, limit, offset: nextOffset })) as PoolItem[];
        // Keep raw for debugging while being tolerant to backend changes.
        const normalized: PoolItem[] = (Array.isArray(next) ? next : []).map((x) => ({ ...(x as PoolItem), _raw: x }));
        setItems((prev) => (append ? [...prev, ...normalized] : normalized));
        setOffset(nextOffset);
      } catch (e: unknown) {
        const err = e as { response?: { status?: number; data?: { error?: string; errorCode?: unknown } } };
        if (err.response?.status === 401) {
          // Do NOT hard-redirect automatically: user may appear logged in (stale UI) or be mid-flow.
          setAuthRequired(true);
          toast.error(t('pool.authRequired', { defaultValue: 'Authentication required to view the pool.' }));
          return;
        }
        if (err.response?.status === 403) {
          toast.error(t('pool.noAccess', { defaultValue: 'Pool is available only for beta users.' }));
        } else {
          toast.error(t('pool.failedToLoad', { defaultValue: 'Failed to load pool.' }));
        }
      }
    },
    [q, limit, t],
  );

  useEffect(() => {
    setLoading(true);
    void (async () => {
      try {
        await loadPage(0, false);
      } finally {
        setLoading(false);
      }
    })();
  }, [loadPage]);

  // If the page was loaded while auth was still being established (fresh OAuth redirect),
  // we may have shown "Sign in required" from an early 401. Once user appears, clear it and retry.
  useEffect(() => {
    if (!user) return;
    if (!authRequired) return;
    setAuthRequired(false);
    void loadPage(0, false);
  }, [authRequired, loadPage, user]);

  const runAdd = async (memeAssetId: string, title: string) => {
    try {
      if (submittingAssetId) return;
      setSubmittingAssetId(memeAssetId);
      const resp = await createPoolSubmission({ memeAssetId, title, channelId: submitChannelId! });
      const r = (resp && typeof resp === 'object' ? (resp as Record<string, unknown>) : null) || null;
      const isDirect = r?.isDirectApproval === true;
      toast.success(
        isDirect
          ? t('pool.addedDirect', { defaultValue: 'Added to your channel.' })
          : t('pool.submissionCreated', { defaultValue: 'Submitted for approval.' }),
      );
    } catch (e: unknown) {
      const maybeTimeout = e as { isTimeout?: boolean; message?: string };
      if (maybeTimeout?.isTimeout || String(maybeTimeout?.message || '').toLowerCase().includes('timeout')) {
        toast.error(
          t('pool.submitTimeout', {
            defaultValue: 'Request timed out. The submission may still have been created — check your submissions.',
          }),
        );
        return;
      }
      const err = e as { response?: { status?: number; data?: { error?: string; errorCode?: unknown } } };
      if (err.response?.status === 401) {
        setAuthRequired(true);
        toast.error(t('pool.authRequired', { defaultValue: 'Authentication required to view the pool.' }));
        return;
      }
      if (err.response?.status === 410) {
        toast.error(t('pool.deletedBlocked', { defaultValue: 'This meme is deleted/quarantined and cannot be used.' }));
        return;
      }
      if (err.response?.status === 409 && err.response?.data?.errorCode === 'ALREADY_IN_CHANNEL') {
        toast.error(t('pool.alreadyInChannel', { defaultValue: 'This meme is already in your channel.' }));
        return;
      }
      const code = err.response?.data?.errorCode;
      const codeStr = typeof code === 'string' ? code : null;
      toast.error(
        (err.response?.data?.error as string | undefined) ||
          (codeStr ? `${t('pool.failedToSubmit', { defaultValue: 'Failed to submit.' })} (${codeStr})` : null) ||
          t('pool.failedToSubmit', { defaultValue: 'Failed to submit.' }),
      );
    } finally {
      setSubmittingAssetId(null);
    }
  };

  const onAdd = async (m: PoolItem) => {
    if (!isAuthed) {
      toast.error(t('pool.loginRequired', { defaultValue: 'Please log in to add memes.' }));
      return;
    }

    if (!submitChannelId) {
      toast.error(
        t('pool.openFromStreamer', {
          defaultValue: 'Open the pool from a streamer profile to submit memes to them.',
        }),
      );
      return;
    }

    const memeAssetId = getPoolMemeAssetId(m);
    if (!memeAssetId) {
      toast.error(t('pool.missingMemeAssetId', { defaultValue: 'This pool item has no memeAssetId.' }));
      return;
    }

    // Channel title is channel-specific; ask for it (prefill sampleTitle if present).
    const suggested = (typeof m.sampleTitle === 'string' && m.sampleTitle.trim()) ? m.sampleTitle.trim() : '';
    const initial = suggested || t('pool.untitled', { defaultValue: 'Untitled' });
    setPendingAdd({ memeAssetId, title: initial });
    setPendingAddTitle(initial);
  };

  return (
    <PageShell header={<Header />}>
      <div className="section-gap">
        <div className="surface p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-xl font-bold text-gray-900 dark:text-white">
                {t('pool.title', { defaultValue: 'Meme pool' })}
              </div>
              <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                {submitMode === 'viewerToStreamer' ? (
                  <>
                    {t('pool.subtitleToStreamer', {
                      defaultValue: 'Pick memes to submit to this streamer as submissions.',
                    })}
                    {targetChannelSlug ? (
                      <span className="ml-2 text-xs text-gray-500 dark:text-gray-400">({targetChannelSlug})</span>
                    ) : null}
                  </>
                ) : submitMode === 'streamerToOwn' ? (
                  t('pool.subtitleToMyChannel', {
                    defaultValue: 'Browse memes and add them to your channel via a submission.',
                  })
                ) : (
                  t('pool.subtitleBrowseOnly', {
                    defaultValue: 'Browse the pool. To submit memes to a streamer, open this page from their profile.',
                  })
                )}
              </div>
            </div>
          </div>

          <div className="mt-4 flex flex-col sm:flex-row gap-2">
            <HelpTooltip content={t('help.pool.search', { defaultValue: 'Search in the global meme pool (by text, id, etc.).' })}>
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={t('pool.searchPlaceholder', { defaultValue: 'Search…' })}
                className="flex-1"
              />
            </HelpTooltip>
            <HelpTooltip content={t('help.pool.runSearch', { defaultValue: 'Run search with the current query.' })}>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setItems([]);
                  setOffset(0);
                  setLoading(true);
                  void (async () => {
                    try {
                      await loadPage(0, false);
                    } finally {
                      setLoading(false);
                    }
                  })();
                }}
                disabled={loading}
              >
                {t('common.search', { defaultValue: 'Search' })}
              </Button>
            </HelpTooltip>
          </div>
        </div>

        {authRequired ? (
          <div className="surface p-6">
            <div className="text-base font-semibold text-gray-900 dark:text-white">
              {t('pool.authRequiredTitle', { defaultValue: 'Sign in required' })}
            </div>
            <div className="mt-2 text-sm text-gray-600 dark:text-gray-300">
              {t('pool.authRequiredHint', { defaultValue: 'Please sign in to view the pool.' })}
            </div>
            <div className="mt-4 flex flex-col sm:flex-row gap-2">
              <HelpTooltip content={t('help.pool.signIn', { defaultValue: 'Sign in to view the pool and submit memes.' })}>
                <Button type="button" variant="primary" onClick={() => login('/pool')}>
                  {t('pool.signIn', { defaultValue: 'Sign in with Twitch' })}
                </Button>
              </HelpTooltip>
              <Button type="button" variant="secondary" onClick={() => void loadPage(0, false)}>
                {t('common.retry', { defaultValue: 'Retry' })}
              </Button>
            </div>
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center gap-3 py-8 text-gray-600 dark:text-gray-300">
            <Spinner className="h-5 w-5" />
            <span>{t('common.loading', { defaultValue: 'Loading…' })}</span>
          </div>
        ) : items.length === 0 ? (
          <div className="surface p-6 text-gray-600 dark:text-gray-300">
            {t('pool.empty', { defaultValue: 'No memes found.' })}
          </div>
        ) : (
          <div className="meme-masonry">
            {items.map((m) => (
              <HelpTooltip content={t('help.pool.openPreview', { defaultValue: 'Open preview. From there you can submit this meme.' })}>
                <div key={m.id} className="relative break-inside-avoid mb-3">
                  <MemeCard
                    meme={toPoolCardMeme(m, t('pool.untitled', { defaultValue: 'Untitled' }))}
                    onClick={() => {
                      setSelectedItem(m);
                      setIsMemeModalOpen(true);
                    }}
                    isOwner={false}
                    previewMode="autoplayMuted"
                  />
                </div>
              </HelpTooltip>
            ))}
          </div>
        )}

        {!loading && items.length > 0 && (
          <div className="flex justify-center">
            <HelpTooltip content={t('help.pool.loadMore', { defaultValue: 'Load more memes from the pool.' })}>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  if (loadingMore) return;
                  setLoadingMore(true);
                  void (async () => {
                    try {
                      await loadPage(offset + limit, true);
                    } finally {
                      setLoadingMore(false);
                    }
                  })();
                }}
                disabled={loadingMore || !canLoadMore}
              >
                {loadingMore ? t('common.loading', { defaultValue: 'Loading…' }) : t('common.loadMore', { defaultValue: 'Load more' })}
              </Button>
            </HelpTooltip>
          </div>
        )}
      </div>

      <ConfirmDialog
        isOpen={!!pendingAdd}
        onClose={() => setPendingAdd(null)}
        onConfirm={() => {
          if (!pendingAdd) return;
          const title = pendingAddTitle.trim();
          if (!title) {
            toast.error(t('pool.addTitleRequired', { defaultValue: 'Please enter a title.' }));
            return;
          }
          void runAdd(pendingAdd.memeAssetId, title);
          setPendingAdd(null);
          setIsMemeModalOpen(false);
          setSelectedItem(null);
        }}
        title={t('pool.addTitleTitle', { defaultValue: 'Add meme to channel' })}
        message={
          <div className="space-y-3">
            <div className="text-sm text-gray-600 dark:text-gray-300">
              {t('pool.addTitleHint', {
                defaultValue: 'Title is channel-specific. Enter how this meme should be named in your channel.',
              })}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t('pool.addTitleLabel', { defaultValue: 'Title' })}
              </label>
              <Input
                value={pendingAddTitle}
                onChange={(e) => setPendingAddTitle(e.target.value)}
                placeholder={t('pool.addTitlePlaceholder', { defaultValue: 'Enter a title…' })}
                autoFocus
              />
            </div>
          </div>
        }
        confirmText={submitMode === 'viewerToStreamer'
          ? t('pool.sendToStreamer', { defaultValue: 'Submit to streamer' })
          : t('pool.addToMyChannel', { defaultValue: 'Add to my channel' })}
        cancelText={t('common.cancel', { defaultValue: 'Cancel' })}
        confirmButtonClass="bg-primary hover:bg-primary/90"
        isLoading={!!submittingAssetId}
      />

      <Modal
        isOpen={isMemeModalOpen && !!selectedItem}
        onClose={() => {
          setIsMemeModalOpen(false);
          setSelectedItem(null);
        }}
        ariaLabel={t('pool.previewModalTitle', { defaultValue: 'Meme preview' })}
        zIndexClassName="z-40"
        overlayClassName="bg-black/40"
        contentClassName="max-w-5xl p-0 overflow-hidden"
      >
        {(() => {
          if (!selectedItem) return null;
          const meme = toPoolCardMeme(selectedItem, t('pool.untitled', { defaultValue: 'Untitled' }));
          const mediaUrl = resolveMediaUrl(meme.fileUrl);
          const isBusyForThis =
            !!submittingAssetId && submittingAssetId === getPoolMemeAssetId(selectedItem);

          return (
            <div className="flex flex-col">
              <div className="relative bg-black">
                {/* top bar */}
                <div className="absolute top-3 left-3 right-3 z-20 flex items-center justify-between gap-2">
                  <HelpTooltip content={t('help.pool.closePreview', { defaultValue: 'Close preview.' })}>
                    <button
                      type="button"
                      onClick={() => {
                        setIsMemeModalOpen(false);
                        setSelectedItem(null);
                      }}
                      className="h-10 w-10 rounded-full bg-black/50 backdrop-blur-md text-white flex items-center justify-center hover:bg-black/60 transition-colors"
                      aria-label={t('common.close', { defaultValue: 'Close' })}
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </HelpTooltip>

                  {meme.type === 'video' ? (
                    <HelpTooltip content={t('help.pool.previewSound', { defaultValue: 'Toggle preview sound. This is saved in your browser.' })}>
                      <button
                        type="button"
                        onClick={() => {
                          const next = !previewMuted;
                          setPreviewMuted(next);
                          try {
                            window.localStorage.setItem(PREVIEW_MUTED_STORAGE_KEY, next ? '1' : '0');
                          } catch {
                            // ignore
                          }
                          if (previewVideoRef.current) previewVideoRef.current.muted = next;
                        }}
                        className="h-10 px-4 rounded-full bg-black/50 backdrop-blur-md text-white hover:bg-black/60 transition-colors font-semibold"
                        aria-pressed={previewMuted}
                      >
                        {previewMuted
                          ? t('common.mute', { defaultValue: 'Без звука' })
                          : t('common.soundOn', { defaultValue: 'Со звуком' })}
                      </button>
                    </HelpTooltip>
                  ) : (
                    <div />
                  )}
                </div>

                <div className="w-full aspect-video sm:aspect-[16/9] overflow-hidden">
                  {meme.type === 'video' ? (
                    <>
                      {/* blurred background for vertical videos */}
                      <video
                        src={mediaUrl}
                        muted
                        loop
                        playsInline
                        className="absolute inset-0 w-full h-full object-cover blur-2xl scale-110 opacity-50"
                        preload="auto"
                        aria-hidden="true"
                      />
                      <div className="absolute inset-0 bg-black/40" aria-hidden="true" />
                      <video
                        ref={previewVideoRef}
                        src={mediaUrl}
                        muted={previewMuted}
                        autoPlay
                        loop
                        playsInline
                        controls
                        className="relative z-10 w-full h-full object-contain"
                        preload="auto"
                      />
                    </>
                  ) : (
                    <img src={mediaUrl} alt={meme.title} className="w-full h-full object-contain" />
                  )}
                </div>
              </div>

              <div className="p-4 sm:p-5 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-lg sm:text-xl font-bold text-gray-900 dark:text-white truncate">
                      {meme.title}
                    </div>
                    <div className="mt-0.5 text-sm text-gray-600 dark:text-gray-300">
                      {t('pool.previewHint', {
                        defaultValue: 'To add, tap the button below.',
                      })}
                    </div>
                  </div>
                </div>

                <HelpTooltip content={t('help.pool.add', { defaultValue: 'Submit this meme. You will be asked to enter a title for your channel.' })}>
                  <Button
                    type="button"
                    variant="primary"
                    className="w-full"
                    onClick={() => void onAdd(selectedItem)}
                    disabled={!isAuthed || !submitChannelId || isBusyForThis}
                  >
                    {submitMode === 'viewerToStreamer'
                      ? t('pool.sendToStreamer', { defaultValue: 'Submit to streamer' })
                      : t('pool.addToMyChannel', { defaultValue: 'Add to my channel' })}
                  </Button>
                </HelpTooltip>

                {!isAuthed ? (
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    {t('pool.loginRequired', { defaultValue: 'Please log in to add memes.' })}
                  </div>
                ) : !submitChannelId ? (
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    {t('pool.openFromStreamer', {
                      defaultValue: 'Open the pool from a streamer profile to submit memes to them.',
                    })}
                  </div>
                ) : null}
              </div>
            </div>
          );
        })()}
      </Modal>
    </PageShell>
  );
}


