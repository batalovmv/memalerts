import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

import type { OwnerTag, OwnerTagCategory, OwnerTagSuggestion, OwnerTagSuggestionStatus } from '@/shared/api/owner';

import {
  approveTagSuggestion,
  getOwnerTagCategories,
  getOwnerTagSuggestions,
  getOwnerTags,
  mapTagSuggestion,
  rejectTagSuggestion,
} from '@/shared/api/owner';
import { useDebounce } from '@/shared/lib/hooks';
import { Button, Input, Select, Spinner } from '@/shared/ui';

type DraftState = {
  displayName?: string;
  categoryId?: string;
  mapTagName?: string;
};

const DEFAULT_LIMIT = 30;

export function OwnerTagModeration() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<OwnerTagSuggestionStatus>('pending');
  const [q, setQ] = useState('');
  const debouncedQ = useDebounce(q, 250);
  const [items, setItems] = useState<OwnerTagSuggestion[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [limit, setLimit] = useState(DEFAULT_LIMIT);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [categories, setCategories] = useState<OwnerTagCategory[]>([]);
  const [tags, setTags] = useState<OwnerTag[]>([]);
  const [drafts, setDrafts] = useState<Record<string, DraftState>>({});
  const refreshTimerRef = useRef<number | null>(null);

  const tagOptions = useMemo(
    () => tags.filter((tag) => tag.name && tag.status !== 'deprecated').slice(0, 200),
    [tags],
  );

  const loadPage = useCallback(
    async (offset: number, append: boolean) => {
      const res = await getOwnerTagSuggestions({
        status,
        q: debouncedQ,
        limit: DEFAULT_LIMIT,
        offset,
      });
      const effectiveLimit = typeof res.limit === 'number' && Number.isFinite(res.limit) ? res.limit : DEFAULT_LIMIT;
      const totalNum = typeof res.total === 'number' && Number.isFinite(res.total) ? res.total : null;

      let nextLen = 0;
      setItems((prev) => {
        const next = append ? [...prev, ...res.items] : res.items;
        nextLen = next.length;
        return next;
      });
      setLimit(effectiveLimit);
      setTotal(totalNum);
      setHasMore(totalNum !== null ? nextLen < totalNum : res.items.length === effectiveLimit);
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
      } catch {
        toast.error(t('ownerTagModeration.failedToLoad', { defaultValue: 'Failed to load suggestions.' }));
      } finally {
        setLoading(false);
      }
    })();
  }, [loadPage, status, t]);

  useEffect(() => {
    void (async () => {
      try {
        const [cats, tagsResp] = await Promise.all([getOwnerTagCategories(), getOwnerTags({ status: 'active', limit: 200, offset: 0 })]);
        setCategories(Array.isArray(cats) ? cats : []);
        setTags(tagsResp.items || []);
      } catch {
        // ignore optional data
      }
    })();
  }, []);

  useEffect(() => {
    const onChange = () => {
      if (refreshTimerRef.current) window.clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = window.setTimeout(() => {
        void loadPage(0, false);
      }, 200);
    };
    window.addEventListener('tags:changed', onChange as EventListener);
    return () => {
      if (refreshTimerRef.current) window.clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
      window.removeEventListener('tags:changed', onChange as EventListener);
    };
  }, [loadPage]);

  const updateDraft = (id: string, patch: Partial<DraftState>) => {
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  };

  const doApprove = async (item: OwnerTagSuggestion) => {
    if (!item.id || busyId) return;
    setBusyId(item.id);
    try {
      const draft = drafts[item.id] || {};
      await approveTagSuggestion(item.id, {
        displayName: draft.displayName || item.rawTag || item.normalizedTag || undefined,
        categoryId: draft.categoryId || undefined,
      });
      toast.success(t('ownerTagModeration.approved', { defaultValue: 'Tag approved.' }));
      await loadPage(0, false);
      window.dispatchEvent(new CustomEvent('tags:changed'));
    } catch (e: unknown) {
      const err = e as { response?: { status?: number; data?: { error?: string } } };
      toast.error(err.response?.data?.error || t('ownerTagModeration.failedToApprove', { defaultValue: 'Failed to approve.' }));
    } finally {
      setBusyId(null);
    }
  };

  const doMap = async (item: OwnerTagSuggestion) => {
    if (!item.id || busyId) return;
    const draft = drafts[item.id] || {};
    const tagName = String(draft.mapTagName || '').trim();
    if (!tagName) {
      toast.error(t('ownerTagModeration.mapMissingTag', { defaultValue: 'Enter a tag name to map.' }));
      return;
    }
    setBusyId(item.id);
    try {
      await mapTagSuggestion(item.id, { tagName });
      toast.success(t('ownerTagModeration.mapped', { defaultValue: 'Suggestion mapped.' }));
      await loadPage(0, false);
      window.dispatchEvent(new CustomEvent('tags:changed'));
    } catch (e: unknown) {
      const err = e as { response?: { status?: number; data?: { error?: string } } };
      toast.error(err.response?.data?.error || t('ownerTagModeration.failedToMap', { defaultValue: 'Failed to map.' }));
    } finally {
      setBusyId(null);
    }
  };

  const doReject = async (item: OwnerTagSuggestion) => {
    if (!item.id || busyId) return;
    setBusyId(item.id);
    try {
      await rejectTagSuggestion(item.id);
      toast.success(t('ownerTagModeration.rejected', { defaultValue: 'Suggestion rejected.' }));
      await loadPage(0, false);
    } catch (e: unknown) {
      const err = e as { response?: { status?: number; data?: { error?: string } } };
      toast.error(err.response?.data?.error || t('ownerTagModeration.failedToReject', { defaultValue: 'Failed to reject.' }));
    } finally {
      setBusyId(null);
    }
  };

  const statusOptions: OwnerTagSuggestionStatus[] = ['pending', 'approved', 'mapped', 'rejected', 'all'];

  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row gap-2 items-start md:items-center justify-between">
        <div>
          <div className="text-lg font-bold text-gray-900 dark:text-white">
            {t('ownerTagModeration.title', { defaultValue: 'Owner: Tag suggestions' })}
          </div>
          <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
            {t('ownerTagModeration.hint', { defaultValue: 'Review auto-tag suggestions and map them to canonical tags.' })}
          </div>
          <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {total !== null
              ? t('ownerTagModeration.metaWithTotal', {
                  defaultValue: 'Showing: {{from}}–{{to}} / {{total}} • limit {{limit}} • next offset {{offset}}',
                  from: items.length > 0 ? 1 : 0,
                  to: items.length,
                  total,
                  limit,
                  offset: items.length,
                })
              : t('ownerTagModeration.meta', {
                  defaultValue: 'Showing: {{to}} • limit {{limit}} • next offset {{offset}}',
                  to: items.length,
                  limit,
                  offset: items.length,
                })}
          </div>
        </div>
      </div>

      <div className="flex flex-col md:flex-row gap-2">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('ownerTagModeration.searchPlaceholder', { defaultValue: 'Search tags…' })}
          className="flex-1"
        />
        <div className="flex flex-wrap gap-2">
          {statusOptions.map((s) => (
            <Button key={s} type="button" variant={status === s ? 'primary' : 'secondary'} onClick={() => setStatus(s)}>
              {t(`ownerTagModeration.status.${s}`, { defaultValue: s })}
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
        </div>
      </div>

      {loading ? (
        <div className="py-8 flex items-center justify-center gap-3 text-gray-600 dark:text-gray-300">
          <Spinner className="h-5 w-5" />
          <span>{t('common.loading', { defaultValue: 'Loading…' })}</span>
        </div>
      ) : items.length === 0 ? (
        <div className="surface p-6 text-gray-600 dark:text-gray-300">
          {t('ownerTagModeration.empty', { defaultValue: 'No suggestions found.' })}
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item) => {
            const isBusy = busyId === item.id;
            const isPending = item.status === 'pending';
            const draft = drafts[item.id] || {};
            const displayValue = draft.displayName ?? item.rawTag ?? item.normalizedTag ?? '';

            return (
              <div key={item.id} className="surface p-4 rounded-xl ring-1 ring-black/5 dark:ring-white/10">
                <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
                  <div>
                    <div className="text-base font-semibold text-gray-900 dark:text-white">{item.rawTag || item.normalizedTag}</div>
                    <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      {t('ownerTagModeration.normalized', { defaultValue: 'Normalized: {{tag}}', tag: item.normalizedTag || '-' })}
                      {typeof item.count === 'number' ? ` • ${t('ownerTagModeration.count', { defaultValue: 'Count: {{count}}', count: item.count })}` : ''}
                    </div>
                  </div>
                  <div className="text-xs font-semibold px-2 py-1 rounded-lg bg-gray-500/10 text-gray-700 dark:text-gray-300">
                    {t(`ownerTagModeration.status.${item.status || 'pending'}`, { defaultValue: item.status || 'pending' })}
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-2">
                  <Input
                    value={displayValue}
                    onChange={(e) => updateDraft(item.id, { displayName: e.target.value })}
                    placeholder={t('ownerTagModeration.displayNamePlaceholder', { defaultValue: 'Display name' })}
                  />
                  <Select
                    value={draft.categoryId || ''}
                    onChange={(e) => updateDraft(item.id, { categoryId: e.target.value })}
                  >
                    <option value="">{t('ownerTagModeration.categoryPlaceholder', { defaultValue: 'Category (optional)' })}</option>
                    {categories.map((cat) => (
                      <option key={cat.id} value={cat.id}>
                        {cat.displayName}
                      </option>
                    ))}
                  </Select>
                  <Select
                    value={draft.mapTagName || ''}
                    onChange={(e) => updateDraft(item.id, { mapTagName: e.target.value })}
                  >
                    <option value="">{t('ownerTagModeration.mapPlaceholder', { defaultValue: 'Map to tag…' })}</option>
                    {tagOptions.map((tag) => (
                      <option key={tag.id} value={tag.name}>
                        {tag.name}
                        {tag.displayName ? ` — ${tag.displayName}` : ''}
                      </option>
                    ))}
                  </Select>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <Button type="button" variant="primary" size="sm" disabled={!isPending || isBusy} onClick={() => doApprove(item)}>
                    {t('ownerTagModeration.approve', { defaultValue: 'Approve' })}
                  </Button>
                  <Button type="button" variant="secondary" size="sm" disabled={!isPending || isBusy} onClick={() => doMap(item)}>
                    {t('ownerTagModeration.map', { defaultValue: 'Map' })}
                  </Button>
                  <Button type="button" variant="secondary" size="sm" disabled={!isPending || isBusy} onClick={() => doReject(item)}>
                    {t('ownerTagModeration.reject', { defaultValue: 'Reject' })}
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
                  toast.error(t('ownerTagModeration.failedToLoad', { defaultValue: 'Failed to load suggestions.' }));
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
  );
}
