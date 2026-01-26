import { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

import type { MemePoolItem } from '@/shared/api/memes/memesPool';
import type { MemeDetail } from '@memalerts/api-contracts';

import { getStarterMemes } from '@/shared/api/memes';
import { createPoolSubmission } from '@/shared/api/submissions/submissionsApi';
import { cn } from '@/shared/lib/cn';
import { Button, Spinner } from '@/shared/ui';
import MemeCard from '@/widgets/meme-card/MemeCard';

const DEFAULT_LIMIT = 12;

type StarterMemesPanelProps = {
  channelId: string;
  isOpen: boolean;
  onImported?: () => void;
  onDismiss?: () => void;
};

const buildMemeTitle = (item: MemePoolItem, fallback: string) =>
  item.aiAutoTitle?.trim() ||
  item.sampleTitle?.trim() ||
  fallback;

const toMemeCard = (item: MemePoolItem, fallbackTitle: string): MemeDetail => {
  const type = item.type || 'video';
  const fileUrl = item.fileUrl || item.previewUrl || item.variants?.[0]?.fileUrl || '';
  const samplePrice =
    typeof item.samplePriceCoins === 'number' && Number.isFinite(item.samplePriceCoins) && item.samplePriceCoins > 0
      ? item.samplePriceCoins
      : 100;
  const qualityScore =
    typeof (item as { qualityScore?: number }).qualityScore === 'number'
      ? (item as { qualityScore?: number }).qualityScore
      : null;

  return {
    id: item.id,
    channelMemeId: item.memeAssetId || item.id,
    memeAssetId: item.memeAssetId || item.id,
    title: buildMemeTitle(item, fallbackTitle),
    type,
    previewUrl: item.previewUrl ?? null,
    variants: item.variants ?? [],
    fileUrl,
    durationMs: typeof item.durationMs === 'number' && Number.isFinite(item.durationMs) ? item.durationMs : 0,
    priceCoins: samplePrice,
    activationsCount: 0,
    createdAt: new Date().toISOString(),
    aiAutoTagNames: Array.isArray(item.aiAutoTagNames) ? item.aiAutoTagNames : null,
    qualityScore,
  };
};

export function StarterMemesPanel({ channelId, isOpen, onImported, onDismiss }: StarterMemesPanelProps) {
  const { t } = useTranslation();
  const [items, setItems] = useState<MemePoolItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  const fallbackTitle = t('dashboard.starterMemesUntitled', { defaultValue: 'Untitled meme' });

  const loadStarterMemes = useCallback(async () => {
    if (!isOpen || !channelId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await getStarterMemes({ limit: DEFAULT_LIMIT });
      setItems(data);
      setSelectedIds(new Set());
    } catch {
      setItems([]);
      setError('failed');
    } finally {
      setLoading(false);
    }
  }, [channelId, isOpen]);

  useEffect(() => {
    void loadStarterMemes();
  }, [loadStarterMemes]);

  const selectedCount = selectedIds.size;
  const hasItems = items.length > 0;
  const isEmpty = !loading && !hasItems;

  const toggleSelected = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleImportSelected = useCallback(async () => {
    if (selectedIds.size === 0 || submitting) return;
    setSubmitting(true);
    const ids = Array.from(selectedIds);
    const results = await Promise.allSettled(
      ids.map(async (id) => {
        await createPoolSubmission({ memeAssetId: id, channelId });
        return id;
      }),
    );
    const succeededIds = results
      .filter((res): res is PromiseFulfilledResult<string> => res.status === 'fulfilled')
      .map((res) => res.value);
    const failedCount = results.length - succeededIds.length;

    if (succeededIds.length > 0) {
      toast.success(
        t('dashboard.starterMemesAdded', {
          defaultValue: 'Added {{count}} memes',
          count: succeededIds.length,
        }),
      );
      setItems((prev) => prev.filter((item) => !succeededIds.includes(item.id)));
      setSelectedIds((prev) => {
        const next = new Set(prev);
        succeededIds.forEach((id) => next.delete(id));
        return next;
      });
      window.dispatchEvent(new CustomEvent('memalerts:channelMemesUpdated', { detail: { channelId } }));
      onImported?.();
    }

    if (failedCount > 0) {
      toast.error(
        t('dashboard.starterMemesFailed', {
          defaultValue: 'Failed to add {{count}} memes',
          count: failedCount,
        }),
      );
    }

    setSubmitting(false);
  }, [channelId, onImported, selectedIds, submitting, t]);

  const handleDismiss = useCallback(() => {
    onDismiss?.();
  }, [onDismiss]);

  const cardItems = useMemo(
    () =>
      items.map((item) => ({
        item,
        meme: toMemeCard(item, fallbackTitle),
        isSelected: selectedIds.has(item.id),
      })),
    [fallbackTitle, items, selectedIds],
  );

  return (
    <section className="mb-6 rounded-2xl border border-white/10 bg-white/70 dark:bg-white/5 p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-gray-500">
            {t('dashboard.starterMemesTitle', { defaultValue: 'Quick start' })}
          </div>
          <h3 className="mt-2 text-xl font-bold text-gray-900 dark:text-white">
            {t('dashboard.starterMemesHeadline', { defaultValue: 'Add popular memes to your catalog' })}
          </h3>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
            {t('dashboard.starterMemesHint', {
              defaultValue: 'Pick a few trending memes so viewers can start sending them right away.',
            })}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="primary"
            size="sm"
            disabled={selectedCount === 0 || submitting}
            onClick={handleImportSelected}
          >
            {submitting ? (
              <>
                <Spinner className="h-4 w-4" />
                {t('dashboard.starterMemesAdding', { defaultValue: 'Adding...' })}
              </>
            ) : (
              t('dashboard.starterMemesAdd', {
                defaultValue: 'Add selected ({{count}})',
                count: selectedCount,
              })
            )}
          </Button>
          <Button type="button" variant="secondary" size="sm" onClick={handleDismiss}>
            {t('dashboard.starterMemesSkip', { defaultValue: 'Skip' })}
          </Button>
        </div>
      </div>

      <div className="mt-5">
        {loading ? (
          <div className="flex items-center justify-center gap-3 py-8 text-gray-600 dark:text-gray-300">
            <Spinner className="h-5 w-5" />
            <span>{t('common.loading', { defaultValue: 'Loading...' })}</span>
          </div>
        ) : error ? (
          <div className="rounded-xl border border-rose-200/60 bg-rose-50/70 dark:border-rose-500/30 dark:bg-rose-500/10 p-4 text-sm text-rose-700 dark:text-rose-200">
            {t('dashboard.starterMemesError', { defaultValue: 'Failed to load starter memes.' })}
          </div>
        ) : isEmpty ? (
          <div className="rounded-xl border border-black/5 dark:border-white/10 bg-white/60 dark:bg-white/5 p-4 text-sm text-gray-600 dark:text-gray-300">
            {t('dashboard.starterMemesEmpty', { defaultValue: 'No starter memes available right now.' })}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {cardItems.map(({ item, meme, isSelected }) => {
              const tags = Array.isArray(item.aiAutoTagNames) ? item.aiAutoTagNames.slice(0, 3) : [];
              return (
                <div
                  key={item.id}
                  className={cn(
                    'text-left rounded-2xl border border-transparent bg-white/70 dark:bg-white/5 p-3 shadow-sm transition-all',
                    'hover:border-black/10 dark:hover:border-white/15',
                    isSelected && 'border-primary/60 ring-2 ring-primary/30',
                  )}
                >
                  <div className="relative">
                    <MemeCard
                      meme={meme}
                      onClick={() => toggleSelected(item.id)}
                      previewMode="hoverMuted"
                    />
                    <div className="absolute top-3 right-3 z-30 pointer-events-none">
                      <span
                        className={cn(
                          'flex h-7 w-7 items-center justify-center rounded-full border text-xs font-bold shadow-sm',
                          isSelected
                            ? 'bg-primary text-white border-primary/70'
                            : 'bg-white/80 text-gray-500 border-white/70',
                        )}
                      >
                        {isSelected ? 'OK' : '+'}
                      </span>
                    </div>
                  </div>
                  <div className="-mt-2">
                    <div className="font-semibold text-sm text-gray-900 dark:text-white truncate">
                      {meme.title}
                    </div>
                    {tags.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {tags.map((tag) => (
                          <span
                            key={tag}
                            className="inline-flex items-center rounded-full bg-black/70 text-white text-[11px] font-semibold px-2 py-0.5"
                          >
                            #{tag}
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                      {t('dashboard.starterMemesUsage', {
                        defaultValue: 'Used by {{count}} channels',
                        count: item.usageCount ?? 0,
                      })}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}


