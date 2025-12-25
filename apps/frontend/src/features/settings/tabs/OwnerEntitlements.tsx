import { useCallback, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

import { api } from '@/lib/api';
import { toApiError } from '@/shared/api/toApiError';
import { Button, Card, Input } from '@/shared/ui';

type OwnerCustomBotEntitlementResponse = unknown;

export function OwnerEntitlements() {
  const { t } = useTranslation();
  const [channelId, setChannelId] = useState('');
  const [loading, setLoading] = useState<'status' | 'grant' | 'revoke' | null>(null);
  const [status, setStatus] = useState<OwnerCustomBotEntitlementResponse | null>(null);

  const normalizedChannelId = useMemo(() => channelId.trim(), [channelId]);

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
            defaultValue: 'Управление entitlement custom-bot для канала по channelId.',
          })}
        </div>

        <div className="mt-4 space-y-2">
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


