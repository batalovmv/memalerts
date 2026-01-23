import { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

import type { OwnerModeratorGrant } from '@/shared/api/owner';

import { getOwnerModerators, grantOwnerModerator, revokeOwnerModerator } from '@/shared/api/owner';
import { Button, Input, Spinner } from '@/shared/ui';
import ConfirmDialog from '@/shared/ui/modals/ConfirmDialog';
import { useAppDispatch } from '@/store/hooks';
import { fetchUser } from '@/store/slices/authSlice';

export function OwnerModerators() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const [loading, setLoading] = useState(false);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [items, setItems] = useState<OwnerModeratorGrant[]>([]);
  const [q, setQ] = useState('');
  const [newUserId, setNewUserId] = useState('');
  const [confirm, setConfirm] = useState<null | { kind: 'grant' | 'revoke'; userId: string }>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await getOwnerModerators();
      setItems(list);
    } catch (e: unknown) {
      const err = e as { response?: { status?: number; data?: { error?: string } } };
      if (err.response?.status === 429) {
        toast.error(t('common.tooManyRequests', { defaultValue: 'Too many requests. Please try again later.' }));
      } else {
        toast.error(err.response?.data?.error || t('ownerModerators.failedToLoad', { defaultValue: 'Failed to load moderators.' }));
      }
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((g) => {
      const name = (g.user?.displayName || '').toLowerCase();
      const id = (g.userId || '').toLowerCase();
      return name.includes(needle) || id.includes(needle);
    });
  }, [items, q]);

  const doGrant = async (userId: string) => {
    if (!userId) return;
    if (busyUserId) return;
    setBusyUserId(userId);
    try {
      await grantOwnerModerator(userId);
      toast.success(t('ownerModerators.granted', { defaultValue: 'Moderator granted.' }));
      setNewUserId('');
      await load();
      // If owner grants/revokes themselves, refresh /me so menu and routes update without relog.
      dispatch(fetchUser());
      toast(t('ownerModerators.sessionHint', { defaultValue: 'If you granted rights to yourself, refresh the page (or relog) to update access.' }));
    } catch (e: unknown) {
      const err = e as { response?: { status?: number; data?: { error?: string } } };
      if (err.response?.status === 429) {
        toast.error(t('common.tooManyRequests', { defaultValue: 'Too many requests. Please try again later.' }));
      } else {
        toast.error(err.response?.data?.error || t('ownerModerators.failedToGrant', { defaultValue: 'Failed to grant moderator.' }));
      }
    } finally {
      setBusyUserId(null);
    }
  };

  const doRevoke = async (userId: string) => {
    if (!userId) return;
    if (busyUserId) return;
    setBusyUserId(userId);
    try {
      await revokeOwnerModerator(userId);
      toast.success(t('ownerModerators.revoked', { defaultValue: 'Moderator revoked.' }));
      await load();
      dispatch(fetchUser());
    } catch (e: unknown) {
      const err = e as { response?: { status?: number; data?: { error?: string } } };
      if (err.response?.status === 429) {
        toast.error(t('common.tooManyRequests', { defaultValue: 'Too many requests. Please try again later.' }));
      } else {
        toast.error(err.response?.data?.error || t('ownerModerators.failedToRevoke', { defaultValue: 'Failed to revoke moderator.' }));
      }
    } finally {
      setBusyUserId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <div className="text-lg font-bold text-gray-900 dark:text-white">{t('ownerModerators.title', { defaultValue: 'Owner: Moderators' })}</div>
        <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
          {t('ownerModerators.hint', { defaultValue: 'Grant or revoke GlobalModerator access.' })}
        </div>
      </div>

      <div className="surface p-4 rounded-xl ring-1 ring-black/5 dark:ring-white/10">
        <div className="text-sm font-semibold text-gray-900 dark:text-white">
          {t('ownerModerators.grantTitle', { defaultValue: 'Grant moderator' })}
        </div>
        <div className="mt-2 flex flex-col sm:flex-row gap-2">
          <Input
            value={newUserId}
            onChange={(e) => setNewUserId(e.target.value)}
            placeholder={t('ownerModerators.userIdPlaceholder', { defaultValue: 'User ID…' })}
            className="flex-1"
          />
          <Button
            type="button"
            variant="primary"
            disabled={!newUserId.trim() || !!busyUserId}
            onClick={() => setConfirm({ kind: 'grant', userId: newUserId.trim() })}
          >
            {t('ownerModerators.grant', { defaultValue: 'Grant' })}
          </Button>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-2 items-center justify-between">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('ownerModerators.searchPlaceholder', { defaultValue: 'Search…' })}
          className="w-full sm:max-w-md"
        />
        <Button type="button" variant="secondary" onClick={() => void load()} disabled={loading}>
          {t('common.refresh', { defaultValue: 'Refresh' })}
        </Button>
      </div>

      {loading ? (
        <div className="py-8 flex items-center justify-center gap-3 text-gray-600 dark:text-gray-300">
          <Spinner className="h-5 w-5" />
          <span>{t('common.loading', { defaultValue: 'Loading…' })}</span>
        </div>
      ) : filtered.length === 0 ? (
        <div className="surface p-6 text-gray-600 dark:text-gray-300">{t('ownerModerators.empty', { defaultValue: 'No moderators.' })}</div>
      ) : (
        <div className="space-y-2">
          {filtered.map((g) => {
            const isBusy = busyUserId === g.userId;
            return (
              <div key={`${g.userId}-${g.id}`} className="surface p-4 rounded-xl ring-1 ring-black/5 dark:ring-white/10 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-semibold text-gray-900 dark:text-white truncate">{g.user?.displayName || g.userId}</div>
                  <div className="text-xs text-gray-600 dark:text-gray-400 truncate">{g.userId}</div>
                  <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    {g.active
                      ? t('ownerModerators.active', { defaultValue: 'Active' })
                      : t('ownerModerators.revokedState', { defaultValue: 'Revoked' })}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {g.active ? (
                    <Button type="button" variant="danger" size="sm" disabled={isBusy} onClick={() => setConfirm({ kind: 'revoke', userId: g.userId })}>
                      {t('ownerModerators.revoke', { defaultValue: 'Revoke' })}
                    </Button>
                  ) : (
                    <Button type="button" variant="success" size="sm" disabled={isBusy} onClick={() => setConfirm({ kind: 'grant', userId: g.userId })}>
                      {t('ownerModerators.grant', { defaultValue: 'Grant' })}
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        isOpen={!!confirm}
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          if (!confirm) return;
          const { kind, userId } = confirm;
          setConfirm(null);
          if (kind === 'grant') void doGrant(userId);
          if (kind === 'revoke') void doRevoke(userId);
        }}
        title={
          confirm?.kind === 'grant'
            ? t('ownerModerators.grantConfirmTitle', { defaultValue: 'Grant moderator' })
            : t('ownerModerators.revokeConfirmTitle', { defaultValue: 'Revoke moderator' })
        }
        message={
          <div className="text-sm text-gray-600 dark:text-gray-300">
            {confirm?.kind === 'grant'
              ? t('ownerModerators.grantConfirm', { defaultValue: 'Grant moderator access for this user?' })
              : t('ownerModerators.revokeConfirm', { defaultValue: 'Revoke moderator access for this user?' })}
            <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">{confirm?.userId}</div>
          </div>
        }
        confirmText={confirm?.kind === 'grant' ? t('ownerModerators.grant', { defaultValue: 'Grant' }) : t('ownerModerators.revoke', { defaultValue: 'Revoke' })}
        cancelText={t('common.cancel', { defaultValue: 'Cancel' })}
        confirmButtonClass={confirm?.kind === 'grant' ? 'bg-primary hover:bg-primary/90' : 'bg-red-600 hover:bg-red-700'}
        isLoading={!!busyUserId}
      />
    </div>
  );
}


