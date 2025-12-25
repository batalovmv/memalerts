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


