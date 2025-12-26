import { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';

import type { MemePoolItem } from '@/shared/api/memesPool';
import type { Meme } from '@/types';

import Header from '@/components/Header';
import MemeCard from '@/components/MemeCard';
import { login } from '@/lib/auth';
import { getMemesPool } from '@/shared/api/memesPool';
import { createPoolSubmission } from '@/shared/api/submissionsPool';
import { PageShell, Button, Input, Spinner } from '@/shared/ui';
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
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t('pool.searchPlaceholder', { defaultValue: 'Search…' })}
              className="flex-1"
            />
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
              <Button type="button" variant="primary" onClick={() => login('/pool')}>
                {t('pool.signIn', { defaultValue: 'Sign in with Twitch' })}
              </Button>
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
              <div key={m.id} className="relative break-inside-avoid mb-3">
                <MemeCard meme={toPoolCardMeme(m, t('pool.untitled', { defaultValue: 'Untitled' }))} onClick={() => {}} isOwner={false} previewMode="autoplayMuted" />
                <div className="absolute left-3 right-3 bottom-3 z-10">
                  <Button
                    type="button"
                    variant="primary"
                    className="w-full"
                    onClick={() => void onAdd(m)}
                    disabled={!isAuthed || !submitChannelId || (!!submittingAssetId && submittingAssetId !== getPoolMemeAssetId(m))}
                  >
                    {submitMode === 'viewerToStreamer'
                      ? t('pool.sendToStreamer', { defaultValue: 'Submit to streamer' })
                      : t('pool.addToMyChannel', { defaultValue: 'Add to my channel' })}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        {!loading && items.length > 0 && (
          <div className="flex justify-center">
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
    </PageShell>
  );
}


