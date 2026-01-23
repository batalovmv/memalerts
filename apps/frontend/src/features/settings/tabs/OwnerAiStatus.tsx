import { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

import type { OwnerAiProcessingItem, OwnerAiStatusResponse } from '@/shared/api/owner';

import { getOwnerAiStatus } from '@/shared/api/owner';
import { Button, Input, Spinner, Pill } from '@/shared/ui';

function formatIsoLocal(iso: string | null | undefined): string {
  if (!iso) return '—';
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  return new Date(ms).toLocaleString();
}

function formatAge(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const diffMs = Date.now() - ms;
  if (!Number.isFinite(diffMs)) return null;
  const mins = Math.round(diffMs / 60_000);
  if (mins < 1) return '<1m';
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  return `${hours}h`;
}

function shortHash(h: string | null | undefined): string {
  const s = (h || '').trim();
  if (!s) return '—';
  if (s.length <= 12) return s;
  return `${s.slice(0, 8)}…${s.slice(-4)}`;
}

function parseTake(v: string): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 50;
  return Math.max(1, Math.min(500, Math.floor(n)));
}

export function OwnerAiStatus() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<OwnerAiStatusResponse | null>(null);
  const [take, setTake] = useState('50');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getOwnerAiStatus({ take: parseTake(take) });
      setData(res);
    } catch (e: unknown) {
      const err = e as { response?: { status?: number; data?: { error?: string } } };
      if (err.response?.status === 429) {
        toast.error(t('common.tooManyRequests', { defaultValue: 'Too many requests. Please try again later.' }));
      } else {
        toast.error(err.response?.data?.error || t('ownerAiStatus.failedToLoad', { defaultValue: 'Failed to load AI status.' }));
      }
    } finally {
      setLoading(false);
    }
  }, [t, take]);

  useEffect(() => {
    void load();
  }, [load]);

  const counterEntries = useMemo(() => {
    const counters = data?.counters ?? {};
    return Object.entries(counters).sort((a, b) => a[0].localeCompare(b[0]));
  }, [data?.counters]);

  const items = data?.processing.items || [];
  const stuckCount = items.reduce((acc, x) => acc + (x.stuck ? 1 : 0), 0);

  const renderError = (x: OwnerAiProcessingItem) => {
    const s = (x.error || '').trim();
    if (!s) return '—';
    if (s.length <= 140) return s;
    return `${s.slice(0, 140)}…`;
  };

  return (
    <div className="space-y-4">
      <div>
        <div className="text-lg font-bold text-gray-900 dark:text-white">{t('ownerAiStatus.title', { defaultValue: 'Owner: AI status' })}</div>
        <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
          {t('ownerAiStatus.hint', { defaultValue: 'Что сейчас обрабатывается, и какие элементы застряли.' })}
        </div>
      </div>

      <div className="surface p-4 rounded-xl ring-1 ring-black/5 dark:ring-white/10">
        <div className="flex flex-col sm:flex-row gap-2 sm:items-end sm:justify-between">
          <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
            <div className="min-w-[140px]">
              <div className="text-xs font-semibold text-gray-700 dark:text-gray-300">take</div>
              <Input value={take} onChange={(e) => setTake(e.target.value)} inputMode="numeric" placeholder="50" />
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400 sm:pb-2">
              {t('ownerAiStatus.takeHint', { defaultValue: 'Сколько элементов показать (1–500).' })}
            </div>
          </div>

          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={() => void load()} disabled={loading}>
              {t('common.refresh', { defaultValue: 'Refresh' })}
            </Button>
          </div>
        </div>

        <div className="mt-4">
          <div className="text-sm font-semibold text-gray-900 dark:text-white">{t('ownerAiStatus.counters', { defaultValue: 'Counters' })}</div>
          {counterEntries.length === 0 ? (
            <div className="mt-2 text-sm text-gray-600 dark:text-gray-300">—</div>
          ) : (
            <div className="mt-2 flex flex-wrap gap-2">
              {counterEntries.map(([k, v]) => (
                <Pill key={k} variant="neutral" size="sm">
                  {k}: {v}
                </Pill>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="surface p-4 rounded-xl ring-1 ring-black/5 dark:ring-white/10">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-semibold text-gray-900 dark:text-white">
            {t('ownerAiStatus.processingItems', { defaultValue: 'Processing items' })}
          </div>
          <div className="flex items-center gap-2">
            {stuckCount > 0 ? (
              <Pill variant="danger" size="sm">
                stuck: {stuckCount}
              </Pill>
            ) : (
              <Pill variant="success" size="sm">
                stuck: 0
              </Pill>
            )}
            <Pill variant="neutral" size="sm">
              total: {items.length}
            </Pill>
          </div>
        </div>

        {loading ? (
          <div className="py-8 flex items-center justify-center gap-3 text-gray-600 dark:text-gray-300">
            <Spinner className="h-5 w-5" />
            <span>{t('common.loading', { defaultValue: 'Loading…' })}</span>
          </div>
        ) : items.length === 0 ? (
          <div className="mt-3 text-sm text-gray-600 dark:text-gray-300">{t('ownerAiStatus.empty', { defaultValue: 'Нет элементов в обработке.' })}</div>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-[900px] w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-600 dark:text-gray-300">
                  <th className="py-2 pr-3">{t('ownerAiStatus.colStuck', { defaultValue: 'stuck' })}</th>
                  <th className="py-2 pr-3">{t('ownerAiStatus.colChannel', { defaultValue: 'channel' })}</th>
                  <th className="py-2 pr-3">{t('ownerAiStatus.colFileHash', { defaultValue: 'fileHash' })}</th>
                  <th className="py-2 pr-3">{t('ownerAiStatus.colLastTriedAt', { defaultValue: 'aiLastTriedAt' })}</th>
                  <th className="py-2 pr-3">{t('ownerAiStatus.colError', { defaultValue: 'error' })}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((x, idx) => {
                  const age = formatAge(x.aiLastTriedAt);
                  return (
                    <tr
                      key={`${x.channelSlug || 'c'}-${x.fileHash || 'h'}-${idx}`}
                      className={x.stuck ? 'bg-red-500/5 dark:bg-red-500/10' : 'border-t border-black/5 dark:border-white/10'}
                    >
                      <td className="py-2 pr-3 align-top">
                        {x.stuck ? (
                          <Pill variant="danger" size="sm">
                            stuck
                          </Pill>
                        ) : (
                          <Pill variant="neutral" size="sm">
                            ok
                          </Pill>
                        )}
                      </td>
                      <td className="py-2 pr-3 align-top">
                        <span className="font-mono text-xs">{x.channelSlug || '—'}</span>
                      </td>
                      <td className="py-2 pr-3 align-top" title={x.fileHash || undefined}>
                        <span className="font-mono text-xs">{shortHash(x.fileHash)}</span>
                      </td>
                      <td className="py-2 pr-3 align-top" title={x.aiLastTriedAt || undefined}>
                        <div className="text-xs text-gray-700 dark:text-gray-200">{formatIsoLocal(x.aiLastTriedAt)}</div>
                        {age ? <div className="text-[11px] text-gray-500 dark:text-gray-400">{age} ago</div> : null}
                      </td>
                      <td className="py-2 pr-3 align-top">
                        <div className="text-xs text-gray-700 dark:text-gray-200 whitespace-pre-wrap">{renderError(x)}</div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}


