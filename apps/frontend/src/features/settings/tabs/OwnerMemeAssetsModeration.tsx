import { useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';

import type { OwnerMemeAsset, OwnerMemeAssetStatus } from '@/shared/api/ownerMemeAssets';

import { useDebounce } from '@/hooks/useDebounce';
import { resolveMediaUrl } from '@/lib/urls';
import { getOwnerMemeAssets, ownerRestoreMemeAsset } from '@/shared/api/ownerMemeAssets';
import { cn } from '@/shared/lib/cn';
import { Button, Input, Spinner } from '@/shared/ui';
import ConfirmDialog from '@/shared/ui/modals/ConfirmDialog';

type StatusFilter = OwnerMemeAssetStatus;

function isQuarantined(a: OwnerMemeAsset): boolean {
  return Boolean(a.purgeRequestedAt) && !a.purgedAt;
}
function isPurged(a: OwnerMemeAsset): boolean {
  return Boolean(a.purgedAt);
}

export function OwnerMemeAssetsModeration() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const didInitFromUrlRef = useRef(false);

  const [status, setStatus] = useState<StatusFilter>('quarantine');
  const [q, setQ] = useState('');
  const debouncedQ = useDebounce(q, 250);
  const [items, setItems] = useState<OwnerMemeAsset[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const limit = 30;
  const [effectiveLimit, setEffectiveLimit] = useState(limit);
  const [hasMore, setHasMore] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmRestore, setConfirmRestore] = useState<null | OwnerMemeAsset>(null);

  // Init from URL once (keep keys tab-specific to avoid collisions in settings).
  useEffect(() => {
    if (didInitFromUrlRef.current) return;
    didInitFromUrlRef.current = true;

    const rawStatus = (searchParams.get('ownerAssetsStatus') || '').trim().toLowerCase();
    const rawQ = (searchParams.get('ownerAssetsQ') || '').trim();

    if (rawStatus === 'hidden' || rawStatus === 'quarantine' || rawStatus === 'purged' || rawStatus === 'all') {
      setStatus(rawStatus);
    }
    if (rawQ) setQ(rawQ);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist filters to URL (replace to avoid polluting history on each keystroke).
  useEffect(() => {
    if (!didInitFromUrlRef.current) return;
    const next = new URLSearchParams(searchParams);
    next.set('ownerAssetsStatus', status);
    if (debouncedQ.trim()) next.set('ownerAssetsQ', debouncedQ.trim());
    else next.delete('ownerAssetsQ');
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, debouncedQ]);

  const loadPage = useCallback(
    async (nextOffset: number, append: boolean) => {
      const resp = await getOwnerMemeAssets({ status, q: debouncedQ, limit, offset: nextOffset });
      const eff = typeof resp.limit === 'number' && Number.isFinite(resp.limit) && resp.limit > 0 ? resp.limit : limit;
      const totalNum = typeof resp.total === 'number' && Number.isFinite(resp.total) && resp.total >= 0 ? resp.total : null;
      let nextLen = 0;
      setItems((prev) => {
        const next = append ? [...prev, ...resp.items] : resp.items;
        nextLen = next.length;
        return next;
      });
      setEffectiveLimit(eff);
      setTotal(totalNum);
      setHasMore(totalNum !== null ? nextLen < totalNum : resp.items.length === eff);
    },
    [debouncedQ, status],
  );

  useEffect(() => {
    setItems([]);
    setHasMore(true);
    setTotal(null);
    setLoading(true);
    void (async () => {
      try {
        await loadPage(0, false);
      } catch (e: unknown) {
        const err = e as { response?: { status?: number; data?: { error?: string } } };
        if (err.response?.status === 429) {
          toast.error(t('common.tooManyRequests', { defaultValue: 'Too many requests. Please try again later.' }));
        } else {
          toast.error(err.response?.data?.error || t('ownerModeration.failedToLoad', { defaultValue: 'Failed to load list.' }));
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [loadPage, status, t]);

  const doRestore = async (a: OwnerMemeAsset) => {
    if (!a.id) return;
    if (busyId) return;
    setBusyId(a.id);
    try {
      await ownerRestoreMemeAsset(a.id);
      toast.success(t('ownerModeration.restored', { defaultValue: 'Restored.' }));
      await loadPage(0, false);
    } catch (e: unknown) {
      const err = e as { response?: { status?: number; data?: { error?: string } } };
      if (err.response?.status === 429) {
        toast.error(t('common.tooManyRequests', { defaultValue: 'Too many requests. Please try again later.' }));
      } else {
        toast.error(err.response?.data?.error || t('ownerModeration.failedToRestore', { defaultValue: 'Failed to restore.' }));
      }
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row gap-2 items-start md:items-center justify-between">
        <div>
          <div className="text-lg font-bold text-gray-900 dark:text-white">
            {t('ownerModeration.memeAssetsTitle', { defaultValue: 'Owner: Meme assets' })}
          </div>
          <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
            {t('ownerModeration.memeAssetsHint', { defaultValue: 'Review hidden/quarantine/purged assets and restore if needed.' })}
          </div>
          <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {total !== null
              ? t('ownerModeration.metaWithTotal', {
                  defaultValue: 'Showing: {{from}}–{{to}} / {{total}} • limit {{limit}} • next offset {{offset}}',
                  from: items.length > 0 ? 1 : 0,
                  to: items.length,
                  total,
                  limit: effectiveLimit,
                  offset: items.length,
                })
              : t('ownerModeration.meta', {
                  defaultValue: 'Showing: {{to}} • limit {{limit}} • next offset {{offset}}',
                  to: items.length,
                  limit: effectiveLimit,
                  offset: items.length,
                })}
          </div>
        </div>
      </div>

      <div className="flex flex-col md:flex-row gap-2">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('ownerModeration.searchPlaceholder', { defaultValue: 'Search by id/hash…' })}
          className="flex-1"
        />
        <div className="flex flex-wrap gap-2">
          {(['hidden', 'quarantine', 'purged', 'all'] as const).map((s) => (
            <Button key={s} type="button" variant={status === s ? 'primary' : 'secondary'} onClick={() => setStatus(s)}>
              {t(`ownerModeration.status.${s}`, { defaultValue: s })}
            </Button>
          ))}
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
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
            {t('common.refresh', { defaultValue: 'Refresh' })}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setQ('');
              setStatus('quarantine');
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
            disabled={loading || loadingMore}
          >
            {t('common.reset', { defaultValue: 'Reset' })}
          </Button>
          {items.length > effectiveLimit ? (
            <Button type="button" variant="secondary" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
              {t('common.backToTop', { defaultValue: 'Back to top' })}
            </Button>
          ) : null}
        </div>
      </div>

      {loading ? (
        <div className="py-8 flex items-center justify-center gap-3 text-gray-600 dark:text-gray-300">
          <Spinner className="h-5 w-5" />
          <span>{t('common.loading', { defaultValue: 'Loading…' })}</span>
        </div>
      ) : items.length === 0 ? (
        <div className="surface p-6 text-gray-600 dark:text-gray-300">{t('ownerModeration.empty', { defaultValue: 'No items found.' })}</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {items.map((a) => {
            const isBusy = busyId === a.id;
            const media = a.fileUrl ? resolveMediaUrl(a.fileUrl) : '';
            const quarantined = isQuarantined(a);
            const purged = isPurged(a);
            const hidden = (a.poolVisibility || '').toLowerCase() === 'hidden';
            const badge = purged
              ? t('ownerModeration.badge.purged', { defaultValue: 'Purged' })
              : quarantined
                ? t('ownerModeration.badge.quarantine', { defaultValue: 'Quarantine' })
                : hidden
                  ? t('ownerModeration.badge.hidden', { defaultValue: 'Hidden' })
                  : t('ownerModeration.badge.visible', { defaultValue: 'Visible' });
            return (
              <div key={a.id} className="surface overflow-hidden rounded-xl ring-1 ring-black/5 dark:ring-white/10">
                <div className="bg-black/90 aspect-video overflow-hidden">
                  {media ? (
                    a.type === 'video' ? (
                      <video src={media} muted playsInline loop autoPlay className="w-full h-full object-contain" />
                    ) : (
                      <img src={media} alt={a.id} className="w-full h-full object-contain" />
                    )
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-xs text-gray-300">
                      {t('common.notAvailable', { defaultValue: 'Not available' })}
                    </div>
                  )}
                </div>
                <div className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-semibold text-gray-900 dark:text-white truncate">{a.id.slice(0, 8)}</div>
                      <div className="mt-0.5 text-xs text-gray-600 dark:text-gray-400 truncate">
                        {a.id}
                        {a.fileHash ? ` • ${a.fileHash.slice(0, 10)}` : ''}
                      </div>
                    </div>
                    <span
                      className={cn(
                        'shrink-0 text-xs font-semibold px-2 py-1 rounded-lg',
                        purged
                          ? 'bg-rose-500/15 text-rose-700 dark:text-rose-300'
                          : quarantined
                            ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                            : hidden
                              ? 'bg-gray-500/15 text-gray-700 dark:text-gray-300'
                              : 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
                      )}
                    >
                      {badge}
                    </span>
                  </div>

                  <Button
                    type="button"
                    variant="success"
                    size="sm"
                    className="w-full"
                    disabled={isBusy}
                    onClick={() => setConfirmRestore(a)}
                  >
                    {t('ownerModeration.restore', { defaultValue: 'Restore' })}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {!loading && items.length > 0 && (
        <div className="flex justify-center">
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              if (loadingMore) return;
              if (!hasMore) return;
              setLoadingMore(true);
              void (async () => {
                try {
                  await loadPage(items.length, true);
                } catch {
                  toast.error(t('ownerModeration.failedToLoad', { defaultValue: 'Failed to load list.' }));
                } finally {
                  setLoadingMore(false);
                }
              })();
            }}
            disabled={loadingMore || !hasMore}
          >
            {loadingMore ? t('common.loading', { defaultValue: 'Loading…' }) : t('common.loadMore', { defaultValue: 'Load more' })}
          </Button>
        </div>
      )}

      <ConfirmDialog
        isOpen={!!confirmRestore}
        onClose={() => setConfirmRestore(null)}
        onConfirm={() => {
          if (!confirmRestore) return;
          const a = confirmRestore;
          setConfirmRestore(null);
          void doRestore(a);
        }}
        title={t('ownerModeration.restoreTitle', { defaultValue: 'Restore asset' })}
        message={
          <div className="text-sm text-gray-600 dark:text-gray-300">
            {t('ownerModeration.restoreConfirm', { defaultValue: 'Restore this meme asset back to visible state?' })}
          </div>
        }
        confirmText={t('ownerModeration.restore', { defaultValue: 'Restore' })}
        cancelText={t('common.cancel', { defaultValue: 'Cancel' })}
        confirmButtonClass="bg-emerald-600 hover:bg-emerald-700"
        isLoading={!!busyId}
      />
    </div>
  );
}


