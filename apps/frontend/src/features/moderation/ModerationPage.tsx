import { useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';

import Header from '@/components/Header';
import { useDebounce } from '@/hooks/useDebounce';
import { login } from '@/lib/auth';
import { resolveMediaUrl } from '@/lib/urls';
import {
  type ModerationMemeAsset,
  type ModerationMemeAssetStatus,
  getModerationMemeAssets,
  moderationHideMemeAsset,
  moderationQuarantineMemeAsset,
  moderationUnhideMemeAsset,
} from '@/shared/api/moderationMemeAssets';
import { cn } from '@/shared/lib/cn';
import { canModerateGlobalPool } from '@/shared/lib/permissions';
import { Button, Input, PageShell, Spinner, Textarea } from '@/shared/ui';
import ConfirmDialog from '@/shared/ui/modals/ConfirmDialog';
import { useAppSelector } from '@/store/hooks';

type StatusFilter = ModerationMemeAssetStatus;

function isQuarantined(a: ModerationMemeAsset): boolean {
  return Boolean(a.purgeRequestedAt) && !a.purgedAt;
}
function isPurged(a: ModerationMemeAsset): boolean {
  return Boolean(a.purgedAt);
}

function getAssetTitle(a: ModerationMemeAsset): string {
  // Global pool assets have no canonical title; use short ID as label.
  const id = (a.id || '').trim();
  return id ? `Asset ${id.slice(0, 8)}` : 'Asset';
}

export default function ModerationPage() {
  const { t } = useTranslation();
  const { user, loading: authLoading } = useAppSelector((s) => s.auth);
  const [searchParams, setSearchParams] = useSearchParams();
  const didInitFromUrlRef = useRef(false);

  const allowed = canModerateGlobalPool(user);

  const [status, setStatus] = useState<StatusFilter>('hidden');
  const [q, setQ] = useState('');
  const debouncedQ = useDebounce(q, 250);
  const [items, setItems] = useState<ModerationMemeAsset[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const limit = 30;
  const [effectiveLimit, setEffectiveLimit] = useState(limit);
  const [hasMore, setHasMore] = useState(true);

  const [busyId, setBusyId] = useState<string | null>(null);

  const [confirm, setConfirm] = useState<null | { kind: 'hide' | 'unhide' | 'quarantine'; asset: ModerationMemeAsset }>(null);
  const [reason, setReason] = useState('');

  // Init from URL once (supports sharing links).
  useEffect(() => {
    if (didInitFromUrlRef.current) return;
    didInitFromUrlRef.current = true;

    const rawStatus = (searchParams.get('status') || '').trim().toLowerCase();
    const rawQ = (searchParams.get('q') || '').trim();

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
    next.set('status', status);
    if (debouncedQ.trim()) next.set('q', debouncedQ.trim());
    else next.delete('q');
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, debouncedQ]);

  const loadPage = useCallback(
    async (nextOffset: number, append: boolean) => {
      const resp = await getModerationMemeAssets({ status, q: debouncedQ, limit, offset: nextOffset });
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
    if (!allowed) return;
    setLoading(true);
    void (async () => {
      try {
        await loadPage(0, false);
      } catch (e: unknown) {
        const err = e as { response?: { status?: number; data?: { error?: string } } };
        if (err.response?.status === 401) {
          toast.error(t('auth.loginRequired', { defaultValue: 'Please log in to use this feature.' }));
        } else if (err.response?.status === 429) {
          toast.error(t('common.tooManyRequests', { defaultValue: 'Too many requests. Please try again later.' }));
        } else if (err.response?.status === 403) {
          toast.error(t('moderation.noAccess', { defaultValue: 'Access denied.' }));
        } else {
          toast.error(err.response?.data?.error || t('moderation.failedToLoad', { defaultValue: 'Failed to load moderation list.' }));
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [allowed, loadPage, status, t]);

  const doAction = async (kind: 'hide' | 'unhide' | 'quarantine', asset: ModerationMemeAsset, reasonText?: string) => {
    if (!asset.id) return;
    if (busyId) return;
    setBusyId(asset.id);
    try {
      if (kind === 'hide') {
        await moderationHideMemeAsset(asset.id);
        toast.success(t('moderation.hidden', { defaultValue: 'Hidden.' }));
      } else if (kind === 'unhide') {
        await moderationUnhideMemeAsset(asset.id);
        toast.success(t('moderation.unhidden', { defaultValue: 'Unhidden.' }));
      } else {
        const r = (reasonText || '').trim();
        if (r.length < 3) {
          toast.error(t('moderation.reasonTooShort', { defaultValue: 'Reason must be at least 3 characters.' }));
          return;
        }
        await moderationQuarantineMemeAsset(asset.id, r);
        toast.success(t('moderation.quarantined', { defaultValue: 'Moved to quarantine.' }));
      }

      // Refresh current page for correctness (server is source of truth).
      await loadPage(0, false);
    } catch (e: unknown) {
      const err = e as { response?: { status?: number; data?: { error?: string } } };
      if (err.response?.status === 401) {
        toast.error(t('auth.loginRequired', { defaultValue: 'Please log in to use this feature.' }));
      } else if (err.response?.status === 429) {
        toast.error(t('common.tooManyRequests', { defaultValue: 'Too many requests. Please try again later.' }));
      } else if (err.response?.status === 403) {
        toast.error(t('moderation.noAccess', { defaultValue: 'Access denied.' }));
      } else {
        toast.error(err.response?.data?.error || t('moderation.failedAction', { defaultValue: 'Action failed.' }));
      }
    } finally {
      setBusyId(null);
    }
  };

  if (authLoading) {
    return (
      <PageShell header={<Header />}>
        <div className="min-h-[50vh] flex items-center justify-center gap-3 text-gray-600 dark:text-gray-300">
          <Spinner className="h-5 w-5" />
          <span>{t('common.loading', { defaultValue: 'Loading…' })}</span>
        </div>
      </PageShell>
    );
  }

  if (!user) {
    return (
      <PageShell header={<Header />} containerClassName="max-w-2xl">
        <div className="surface p-6">
          <div className="text-lg font-bold text-gray-900 dark:text-white">
            {t('moderation.loginRequiredTitle', { defaultValue: 'Sign in required' })}
          </div>
          <div className="mt-2 text-sm text-gray-600 dark:text-gray-300">
            {t('moderation.loginRequiredHint', { defaultValue: 'Please sign in to access moderation tools.' })}
          </div>
          <div className="mt-4">
            <Button type="button" variant="primary" onClick={() => login('/moderation')}>
              {t('auth.login', { defaultValue: 'Log in with Twitch' })}
            </Button>
          </div>
        </div>
      </PageShell>
    );
  }

  if (!allowed) {
    return (
      <PageShell header={<Header />} containerClassName="max-w-2xl">
        <div className="surface p-6">
          <div className="text-lg font-bold text-gray-900 dark:text-white">
            {t('moderation.noAccessTitle', { defaultValue: 'Access denied' })}
          </div>
          <div className="mt-2 text-sm text-gray-600 dark:text-gray-300">
            {t('moderation.noAccessHint', { defaultValue: 'You do not have permission to moderate the global pool.' })}
          </div>
        </div>
      </PageShell>
    );
  }

  const shownFrom = items.length > 0 ? 1 : 0;
  const shownTo = items.length;
  const nextOffset = items.length;

  return (
    <PageShell header={<Header />}>
      <div className="section-gap">
        <div className="surface p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-xl font-bold text-gray-900 dark:text-white">
                {t('moderation.title', { defaultValue: 'Pool moderation' })}
              </div>
              <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                {t('moderation.hint', {
                  defaultValue: 'Moderators can only hide/unhide or move items to quarantine. Title/tags cannot be edited here.',
                })}
              </div>
              <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                {total !== null
                  ? t('moderation.metaWithTotal', {
                      defaultValue: 'Showing: {{from}}–{{to}} / {{total}} • limit {{limit}} • next offset {{offset}}',
                      from: shownFrom,
                      to: shownTo,
                      total,
                      limit: effectiveLimit,
                      offset: nextOffset,
                    })
                  : t('moderation.meta', {
                      defaultValue: 'Showing: {{to}} • limit {{limit}} • next offset {{offset}}',
                      to: shownTo,
                      limit: effectiveLimit,
                      offset: nextOffset,
                    })}
              </div>
            </div>
          </div>

          <div className="mt-4 flex flex-col md:flex-row gap-2">
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t('moderation.searchPlaceholder', { defaultValue: 'Search by id/hash…' })}
              className="flex-1"
            />
            <div className="flex flex-wrap gap-2">
              {(['hidden', 'quarantine', 'purged', 'all'] as const).map((s) => (
                <Button
                  key={s}
                  type="button"
                  variant={status === s ? 'primary' : 'secondary'}
                  onClick={() => setStatus(s)}
                >
                  {t(`moderation.status.${s}`, { defaultValue: s })}
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
                  setStatus('hidden');
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
                disabled={loading || loadingMore}
              >
                {t('common.reset', { defaultValue: 'Reset' })}
              </Button>
              {items.length > effectiveLimit ? (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
                >
                  {t('common.backToTop', { defaultValue: 'Back to top' })}
                </Button>
              ) : null}
            </div>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-3 py-8 text-gray-600 dark:text-gray-300">
            <Spinner className="h-5 w-5" />
            <span>{t('common.loading', { defaultValue: 'Loading…' })}</span>
          </div>
        ) : items.length === 0 ? (
          <div className="surface p-6 text-gray-600 dark:text-gray-300">
            {t('moderation.empty', { defaultValue: 'No items found.' })}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {items.map((a) => {
              const isBusy = busyId === a.id;
              const media = a.fileUrl ? resolveMediaUrl(a.fileUrl) : '';
              const quarantined = isQuarantined(a);
              const purged = isPurged(a);
              const hidden = (a.poolVisibility || '').toLowerCase() === 'hidden';

              const badge = purged
                ? t('moderation.badge.purged', { defaultValue: 'Purged' })
                : quarantined
                  ? t('moderation.badge.quarantine', { defaultValue: 'Quarantine' })
                  : hidden
                    ? t('moderation.badge.hidden', { defaultValue: 'Hidden' })
                    : t('moderation.badge.visible', { defaultValue: 'Visible' });

              return (
                <div key={a.id} className="surface overflow-hidden rounded-xl ring-1 ring-black/5 dark:ring-white/10">
                  <div className="bg-black/90 aspect-video overflow-hidden">
                    {media ? (
                      a.type === 'video' ? (
                        <video src={media} muted playsInline loop autoPlay className="w-full h-full object-contain" />
                      ) : (
                        <img src={media} alt={getAssetTitle(a)} className="w-full h-full object-contain" />
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
                        <div className="font-semibold text-gray-900 dark:text-white truncate">{getAssetTitle(a)}</div>
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

                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={isBusy || purged}
                        onClick={() => setConfirm({ kind: 'hide', asset: a })}
                      >
                        {t('moderation.hide', { defaultValue: 'Hide' })}
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={isBusy || purged}
                        onClick={() => setConfirm({ kind: 'unhide', asset: a })}
                      >
                        {t('moderation.unhide', { defaultValue: 'Unhide' })}
                      </Button>
                      <Button
                        type="button"
                        variant="danger"
                        size="sm"
                        disabled={isBusy || purged}
                        onClick={() => {
                          setReason('');
                          setConfirm({ kind: 'quarantine', asset: a });
                        }}
                      >
                        {t('moderation.quarantine', { defaultValue: 'Delete (quarantine)' })}
                      </Button>
                    </div>
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
                    toast.error(t('moderation.failedToLoad', { defaultValue: 'Failed to load moderation list.' }));
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
      </div>

      <ConfirmDialog
        isOpen={!!confirm}
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          if (!confirm) return;
          const { kind, asset } = confirm;
          setConfirm(null);
          void doAction(kind, asset, reason);
        }}
        title={(() => {
          if (!confirm) return '';
          if (confirm.kind === 'hide') return t('moderation.hideTitle', { defaultValue: 'Hide item' });
          if (confirm.kind === 'unhide') return t('moderation.unhideTitle', { defaultValue: 'Unhide item' });
          return t('moderation.quarantineTitle', { defaultValue: 'Delete (quarantine)' });
        })()}
        message={
          confirm?.kind === 'quarantine' ? (
            <div className="space-y-3">
              <div className="text-sm text-gray-600 dark:text-gray-300">
                {t('moderation.quarantineHint', {
                  defaultValue:
                    'This will move the asset into quarantine (not immediately purged). Re-uploading the same file will be blocked. Reason is required.',
                })}
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">
                  {t('moderation.reasonLabel', { defaultValue: 'Reason (required)' })}
                </label>
                <Textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={4}
                  className="w-full"
                  placeholder={t('moderation.reasonPlaceholder', { defaultValue: 'Describe why this should be deleted…' })}
                />
                <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  {t('moderation.reasonMin', { defaultValue: 'Minimum 3 characters.' })}
                </div>
              </div>
            </div>
          ) : (
            <div className="text-sm text-gray-600 dark:text-gray-300">
              {confirm?.kind === 'hide'
                ? t('moderation.hideConfirm', { defaultValue: 'Hide this item from the pool?' })
                : t('moderation.unhideConfirm', { defaultValue: 'Make this item visible in the pool?' })}
            </div>
          )
        }
        confirmText={confirm?.kind === 'quarantine' ? t('common.delete', { defaultValue: 'Delete' }) : t('common.confirm', { defaultValue: 'Confirm' })}
        cancelText={t('common.cancel', { defaultValue: 'Cancel' })}
        confirmButtonClass={confirm?.kind === 'quarantine' ? 'bg-red-600 hover:bg-red-700' : 'bg-primary hover:bg-primary/90'}
        isLoading={!!busyId}
      />
    </PageShell>
  );
}


