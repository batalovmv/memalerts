import { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

import type { Meme } from '@/types';

import Header from '@/components/Header';
import MemeCard from '@/components/MemeCard';
import { login } from '@/lib/auth';
import { getMemesPool } from '@/shared/api/memesPool';
import { createPoolSubmission } from '@/shared/api/submissionsPool';
import { PageShell, Button, Input, Spinner } from '@/shared/ui';
import { useAppSelector } from '@/store/hooks';

type PoolItem = Meme & { memeAssetId?: string | null };

function getPoolMemeAssetId(m: PoolItem): string | null {
  // Backend may return `memeAssetId` explicitly. As a fallback, treat `id` as memeAssetId.
  if (typeof m.memeAssetId === 'string' && m.memeAssetId.trim()) return m.memeAssetId.trim();
  if (typeof m.id === 'string' && m.id.trim()) return m.id.trim();
  return null;
}

export default function PoolPage() {
  const { t } = useTranslation();
  const { user } = useAppSelector((s) => s.auth);
  const isAuthed = !!user;

  const [q, setQ] = useState('');
  const [items, setItems] = useState<PoolItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const limit = 30;

  const canLoadMore = useMemo(() => items.length === 0 || items.length % limit === 0, [items.length]);

  const loadPage = useCallback(
    async (nextOffset: number, append: boolean) => {
      try {
        const next = (await getMemesPool({ q, limit, offset: nextOffset })) as PoolItem[];
        setItems((prev) => (append ? [...prev, ...next] : next));
        setOffset(nextOffset);
      } catch (e: unknown) {
        const err = e as { response?: { status?: number; data?: { error?: string; errorCode?: unknown } } };
        if (err.response?.status === 401) {
          toast.error(t('pool.loginRequired', { defaultValue: 'Please log in to add memes.' }));
          login('/pool');
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

  const onAddToMyChannel = async (m: PoolItem) => {
    if (!isAuthed) {
      toast.error(t('pool.loginRequired', { defaultValue: 'Please log in to add memes.' }));
      return;
    }

    const memeAssetId = getPoolMemeAssetId(m);
    if (!memeAssetId) {
      toast.error(t('pool.missingMemeAssetId', { defaultValue: 'This pool item has no memeAssetId.' }));
      return;
    }

    try {
      await createPoolSubmission({ memeAssetId, title: m.title });
      toast.success(t('pool.submissionCreated', { defaultValue: 'Submitted for approval.' }));
    } catch (e: unknown) {
      const err = e as { response?: { status?: number; data?: { error?: string; errorCode?: unknown } } };
      if (err.response?.status === 401) {
        toast.error(t('pool.loginRequired', { defaultValue: 'Please log in to add memes.' }));
        login('/pool');
        return;
      }
      if (err.response?.status === 409 && err.response?.data?.errorCode === 'ALREADY_IN_CHANNEL') {
        toast.error(t('pool.alreadyInChannel', { defaultValue: 'This meme is already in your channel.' }));
        return;
      }
      toast.error(err.response?.data?.error || t('pool.failedToSubmit', { defaultValue: 'Failed to submit.' }));
    }
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
                {t('pool.subtitle', { defaultValue: 'Browse memes approved in other channels and add them via a submission.' })}
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

        {loading ? (
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
                <MemeCard meme={m} onClick={() => {}} isOwner={false} previewMode="autoplayMuted" />
                <div className="absolute left-3 right-3 bottom-3 z-10">
                  <Button type="button" variant="primary" className="w-full" onClick={() => void onAddToMyChannel(m)}>
                    {t('pool.addToMyChannel', { defaultValue: 'Add to my channel' })}
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
    </PageShell>
  );
}


