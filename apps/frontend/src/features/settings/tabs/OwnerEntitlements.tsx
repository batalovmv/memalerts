import { useCallback, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

import { api } from '@/lib/api';
import { toApiError } from '@/shared/api/toApiError';
import { Button, Card, Input } from '@/shared/ui';

type OwnerCustomBotEntitlementResponse = unknown;

export function OwnerEntitlements() {
  const { t } = useTranslation();
  const [twitchExternalId, setTwitchExternalId] = useState('');
  const [channelId, setChannelId] = useState('');
  const [loading, setLoading] = useState<'resolve' | 'grantByProvider' | 'status' | 'grant' | 'revoke' | null>(null);
  const [status, setStatus] = useState<OwnerCustomBotEntitlementResponse | null>(null);

  const normalizedTwitchExternalId = useMemo(() => twitchExternalId.trim(), [twitchExternalId]);
  const normalizedChannelId = useMemo(() => channelId.trim(), [channelId]);

  const copyText = useCallback(async (label: string, value: string) => {
    const v = String(value || '').trim();
    if (!v) return;
    try {
      await navigator.clipboard.writeText(v);
      toast.success(t('admin.copied', { defaultValue: 'Copied.' }));
    } catch {
      try {
        window.prompt(label, v);
      } catch {
        // ignore
      }
    }
  }, [t]);

  const resolvedFromStatus = useMemo(() => {
    const s = status as
      | {
          channelId?: unknown;
          displayHint?: { twitchChannelId?: unknown };
        }
      | null;
    const resolvedChannelId = typeof s?.channelId === 'string' ? s.channelId : null;
    const hintedTwitchIdRaw = s?.displayHint && typeof s.displayHint === 'object' ? (s.displayHint as { twitchChannelId?: unknown }).twitchChannelId : null;
    const hintedTwitchId = typeof hintedTwitchIdRaw === 'string' ? hintedTwitchIdRaw : null;
    return {
      channelId: resolvedChannelId && resolvedChannelId.trim() ? resolvedChannelId.trim() : null,
      twitchBroadcasterId: hintedTwitchId && hintedTwitchId.trim() ? hintedTwitchId.trim() : null,
    };
  }, [status]);

  const isValidTwitchExternalId = useCallback(
    (v: string): boolean => {
      const s = String(v || '').trim();
      if (!s) return false;
      // Backend validates digits-only broadcaster_id and enforces max length.
      // Keep client-side rules in sync to avoid noisy 400s.
      if (!/^\d+$/.test(s)) return false;
      // Conservative cap; backend also enforces. Twitch broadcaster_id is numeric and fits well under this.
      if (s.length < 3 || s.length > 32) return false;
      return true;
    },
    []
  );

  const resolveTwitchChannel = useCallback(async () => {
    const externalId = normalizedTwitchExternalId;
    if (!isValidTwitchExternalId(externalId)) {
      toast.error(
        t('admin.externalIdInvalid', {
          defaultValue: 'Некорректный Twitch externalId (broadcaster_id). Нужно: только цифры и разумная длина.',
        })
      );
      return;
    }
    const startedAt = Date.now();
    try {
      setLoading('resolve');
      const res = await api.get<unknown>(
        `/owner/channels/resolve?provider=twitch&externalId=${encodeURIComponent(externalId)}`,
        { timeout: 8000 }
      );
      setStatus(res ?? null);
      const resolvedChannelId = (res as { channelId?: unknown } | null)?.channelId;
      if (typeof resolvedChannelId === 'string' && resolvedChannelId.trim()) {
        setChannelId(resolvedChannelId);
      }
      toast.success(t('admin.resolved', { defaultValue: 'Resolved.' }));
    } catch (e) {
      const err = toApiError(e, t('admin.failedToResolve', { defaultValue: 'NOT_FOUND' }));
      toast.error(err.message);
    } finally {
      const elapsed = Date.now() - startedAt;
      if (elapsed < 200) await new Promise((r) => setTimeout(r, 200 - elapsed));
      setLoading(null);
    }
  }, [isValidTwitchExternalId, normalizedTwitchExternalId, t]);

  const grantByProvider = useCallback(async () => {
    const externalId = normalizedTwitchExternalId;
    if (!isValidTwitchExternalId(externalId)) {
      toast.error(
        t('admin.externalIdInvalid', {
          defaultValue: 'Некорректный Twitch externalId (broadcaster_id). Нужно: только цифры и разумная длина.',
        })
      );
      return;
    }
    const startedAt = Date.now();
    try {
      setLoading('grantByProvider');
      const res = await api.post<unknown>('/owner/entitlements/custom-bot/grant-by-provider', {
        provider: 'twitch',
        externalId,
      });
      setStatus(res ?? null);
      const resolvedChannelId = (res as { channelId?: unknown } | null)?.channelId;
      if (typeof resolvedChannelId === 'string' && resolvedChannelId.trim()) {
        setChannelId(resolvedChannelId);
        // best-effort refresh status
        const cid = resolvedChannelId.trim();
        const st = await api.get<unknown>(`/owner/entitlements/custom-bot?channelId=${encodeURIComponent(cid)}`, { timeout: 8000 });
        setStatus(st ?? res ?? null);
      }
      toast.success(t('admin.saved', { defaultValue: 'Saved.' }));
    } catch (e) {
      const err = toApiError(e, t('admin.failedToSave', { defaultValue: 'NOT_FOUND' }));
      toast.error(err.message);
    } finally {
      const elapsed = Date.now() - startedAt;
      if (elapsed < 200) await new Promise((r) => setTimeout(r, 200 - elapsed));
      setLoading(null);
    }
  }, [isValidTwitchExternalId, normalizedTwitchExternalId, t]);

  const loadStatus = useCallback(async () => {
    const cid = normalizedChannelId;
    if (!cid) {
      toast.error(t('admin.channelIdRequired', { defaultValue: 'Введите channelId.' }));
      return;
    }
    const startedAt = Date.now();
    try {
      setLoading('status');
      const res = await api.get<unknown>(`/owner/entitlements/custom-bot?channelId=${encodeURIComponent(cid)}`, { timeout: 8000 });
      setStatus(res ?? null);
      toast.success(t('admin.loaded', { defaultValue: 'Loaded.' }));
    } catch (e) {
      const err = toApiError(e, t('admin.failedToLoad', { defaultValue: 'Failed to load.' }));
      toast.error(err.message);
    } finally {
      // Small UX delay to reduce flicker for fast responses
      const elapsed = Date.now() - startedAt;
      if (elapsed < 200) await new Promise((r) => setTimeout(r, 200 - elapsed));
      setLoading(null);
    }
  }, [normalizedChannelId, t]);

  const grant = useCallback(async () => {
    const cid = normalizedChannelId;
    if (!cid) {
      toast.error(t('admin.channelIdRequired', { defaultValue: 'Введите channelId.' }));
      return;
    }
    const startedAt = Date.now();
    try {
      setLoading('grant');
      await api.post('/owner/entitlements/custom-bot/grant', { channelId: cid });
      toast.success(t('admin.saved', { defaultValue: 'Saved.' }));
      await loadStatus();
    } catch (e) {
      const err = toApiError(e, t('admin.failedToSave', { defaultValue: 'Failed to save.' }));
      toast.error(err.message);
    } finally {
      const elapsed = Date.now() - startedAt;
      if (elapsed < 200) await new Promise((r) => setTimeout(r, 200 - elapsed));
      setLoading(null);
    }
  }, [loadStatus, normalizedChannelId, t]);

  const revoke = useCallback(async () => {
    const cid = normalizedChannelId;
    if (!cid) {
      toast.error(t('admin.channelIdRequired', { defaultValue: 'Введите channelId.' }));
      return;
    }
    const confirmed = window.confirm(t('admin.confirmRevoke', { defaultValue: 'Отозвать entitlement custom-bot для этого channelId?' }));
    if (!confirmed) return;

    const startedAt = Date.now();
    try {
      setLoading('revoke');
      await api.post('/owner/entitlements/custom-bot/revoke', { channelId: cid });
      toast.success(t('admin.saved', { defaultValue: 'Saved.' }));
      await loadStatus();
    } catch (e) {
      const err = toApiError(e, t('admin.failedToSave', { defaultValue: 'Failed to save.' }));
      toast.error(err.message);
    } finally {
      const elapsed = Date.now() - startedAt;
      if (elapsed < 200) await new Promise((r) => setTimeout(r, 200 - elapsed));
      setLoading(null);
    }
  }, [loadStatus, normalizedChannelId, t]);

  const isBusy = loading !== null;
  const displayBroadcasterId = resolvedFromStatus.twitchBroadcasterId || (isValidTwitchExternalId(normalizedTwitchExternalId) ? normalizedTwitchExternalId : null);
  const displayChannelId = normalizedChannelId || resolvedFromStatus.channelId;

  return (
    <div className="space-y-4">
      <Card className="p-6">
        <div className="text-xl font-bold dark:text-white">
          {t('admin.ownerEntitlementsTitle', { defaultValue: 'Owner: Entitlements' })}
        </div>
        <div className="mt-2 text-sm text-gray-600 dark:text-gray-300">
          {t('admin.ownerEntitlementsHint', {
            defaultValue:
              'Рациональный и безопасный способ: резолвим channelId по Twitch broadcaster_id (externalId) и выдаём entitlement. Ни логинов, ни email здесь нет.',
          })}
        </div>

        <div className="mt-4 space-y-2">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
            {t('admin.twitchExternalId', { defaultValue: 'Twitch externalId (broadcaster_id)' })}
          </label>
          <Input
            value={twitchExternalId}
            onChange={(e) => setTwitchExternalId(e.target.value)}
            placeholder="12345"
            disabled={isBusy}
          />
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" onClick={() => void resolveTwitchChannel()} disabled={isBusy || !normalizedTwitchExternalId}>
              {loading === 'resolve' ? t('common.loading', { defaultValue: 'Loading…' }) : t('admin.resolve', { defaultValue: 'Resolve' })}
            </Button>
            <Button type="button" variant="primary" onClick={() => void grantByProvider()} disabled={isBusy || !normalizedTwitchExternalId}>
              {loading === 'grantByProvider'
                ? t('common.loading', { defaultValue: 'Loading…' })
                : t('admin.grantByProvider', { defaultValue: 'Grant (by provider)' })}
            </Button>
          </div>
          <div className="text-xs text-gray-600 dark:text-gray-300">
            {t('admin.resolveHint', {
              defaultValue: 'Grant (by provider) сам резолвит канал и делает upsert entitlement custom_bot.',
            })}
          </div>
        </div>

        {(displayBroadcasterId || displayChannelId) ? (
          <div className="mt-4 rounded-xl bg-black/5 dark:bg-white/5 p-3 ring-1 ring-black/5 dark:ring-white/10">
            <div className="text-sm font-semibold text-gray-900 dark:text-white">
              {t('admin.resolvedSummary', { defaultValue: 'Найдено' })}
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <div className="text-xs text-gray-700 dark:text-gray-200">
                <div className="opacity-70">{t('admin.twitchExternalId', { defaultValue: 'Twitch externalId (broadcaster_id)' })}</div>
                <div className="mt-0.5 font-mono break-all">{displayBroadcasterId ?? '—'}</div>
                {displayBroadcasterId ? (
                  <button
                    type="button"
                    className="mt-1 text-[11px] underline hover:no-underline"
                    onClick={() => void copyText('Twitch broadcaster_id', displayBroadcasterId)}
                  >
                    {t('admin.copy', { defaultValue: 'Copy' })}
                  </button>
                ) : null}
              </div>
              <div className="text-xs text-gray-700 dark:text-gray-200">
                <div className="opacity-70">{t('admin.channelId', { defaultValue: 'channelId' })}</div>
                <div className="mt-0.5 font-mono break-all">{displayChannelId ?? '—'}</div>
                {displayChannelId ? (
                  <button
                    type="button"
                    className="mt-1 text-[11px] underline hover:no-underline"
                    onClick={() => void copyText('channelId', displayChannelId)}
                  >
                    {t('admin.copy', { defaultValue: 'Copy' })}
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}

        <div className="mt-6 border-t border-black/5 dark:border-white/10 pt-4">
          <div className="text-sm font-semibold text-gray-900 dark:text-white">
            {t('admin.advanced', { defaultValue: 'Advanced (manual by channelId)' })}
          </div>
          <div className="mt-3 space-y-2">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
            {t('admin.channelId', { defaultValue: 'channelId' })}
          </label>
          <Input value={channelId} onChange={(e) => setChannelId(e.target.value)} placeholder="123" disabled={isBusy} />
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
          <Button type="button" variant="secondary" onClick={() => void loadStatus()} disabled={isBusy || !normalizedChannelId}>
            {loading === 'status' ? t('common.loading', { defaultValue: 'Loading…' }) : t('admin.status', { defaultValue: 'Status' })}
          </Button>
          <Button type="button" variant="primary" onClick={() => void grant()} disabled={isBusy || !normalizedChannelId}>
            {loading === 'grant' ? t('common.loading', { defaultValue: 'Loading…' }) : t('admin.grant', { defaultValue: 'Grant' })}
          </Button>
          <Button type="button" variant="danger" onClick={() => void revoke()} disabled={isBusy || !normalizedChannelId}>
            {loading === 'revoke' ? t('common.loading', { defaultValue: 'Loading…' }) : t('admin.revoke', { defaultValue: 'Revoke' })}
          </Button>
          </div>
        </div>
      </Card>

      <Card className="p-6">
        <div className="text-sm font-semibold text-gray-900 dark:text-white">
          {t('admin.ownerEntitlementsResult', { defaultValue: 'Result' })}
        </div>
        <pre className="mt-3 text-xs overflow-auto rounded-xl bg-black/5 dark:bg-white/5 p-3">
          {status ? JSON.stringify(status, null, 2) : t('admin.noData', { defaultValue: 'No data.' })}
        </pre>
      </Card>
    </div>
  );
}


