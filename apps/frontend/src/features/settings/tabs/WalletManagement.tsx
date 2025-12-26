import { useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

import { Button, Input, Select, Spinner } from '@/shared/ui';

// Wallet Management Component (Admin only)
export function WalletManagement() {
  const { t } = useTranslation();
  const [wallets, setWallets] = useState<Array<Record<string, unknown>>>([]);
  const [walletUsers, setWalletUsers] = useState<Array<{ id: string; displayName: string; twitchUserId?: string | null }>>([]);
  const [loading, setLoading] = useState(true);
  const [adjusting, setAdjusting] = useState<string | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const [selectedChannelId, setSelectedChannelId] = useState<string>('');
  const [adjustAmount, setAdjustAmount] = useState<string>('');
  const walletsLoadedForUserRef = useRef<string | null>(null);
  const optionsLoadedRef = useRef(false);

  const fetchWalletOptions = useCallback(async () => {
    if (optionsLoadedRef.current) return;
    try {
      optionsLoadedRef.current = true;
      const { api } = await import('@/lib/api');
      const resp = await api.get<{ users: Array<{ id: string; displayName: string; twitchUserId?: string | null }>; channels: Array<{ id: string; name: string; slug: string }> }>(
        '/owner/wallets/options'
      );
      setWalletUsers(resp?.users || []);
    } catch (error: unknown) {
      const apiError = error as { response?: { data?: { error?: string } } };
      optionsLoadedRef.current = false;
      toast.error(apiError.response?.data?.error || t('admin.failedToLoadWallets') || 'Failed to load wallets');
    }
  }, [t]);

  const fetchWallets = useCallback(async (userId?: string, force?: boolean) => {
    const uid = String(userId || selectedUserId || '').trim();
    if (!uid) return;
    if (!force && walletsLoadedForUserRef.current === uid) return;
    
    try {
      setLoading(true);
      const { api } = await import('@/lib/api');
      walletsLoadedForUserRef.current = uid;
      const resp = await api.get<unknown>('/owner/wallets', {
        params: { userId: uid, limit: 200, offset: 0, includeTotal: 0 },
        timeout: 15000,
      });
      const maybeObj = resp && typeof resp === 'object' ? (resp as { items?: unknown }) : null;
      const items = Array.isArray(resp) ? resp : Array.isArray(maybeObj?.items) ? maybeObj?.items : [];
      setWallets(items as Array<Record<string, unknown>>);
    } catch (error: unknown) {
      const apiError = error as { response?: { data?: { error?: string } } };
      walletsLoadedForUserRef.current = null; // Reset on error to allow retry
      toast.error(apiError.response?.data?.error || t('admin.failedToLoadWallets') || 'Failed to load wallets');
    } finally {
      setLoading(false);
    }
  }, [t, selectedUserId]);

  useEffect(() => {
    void fetchWalletOptions();
  }, [fetchWalletOptions]);

  useEffect(() => {
    if (!selectedUserId && walletUsers.length > 0) {
      setSelectedUserId(walletUsers[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletUsers.length]);

  useEffect(() => {
    if (!selectedUserId) return;
    void fetchWallets(selectedUserId, true);
  }, [fetchWallets, selectedUserId]);

  const normalize = (v: string) => String(v || '').trim().toLowerCase();

  const rows = wallets as Array<{
    id: string;
    userId: string;
    channelId: string;
    balance: number;
    user: { id: string; displayName: string; twitchUserId?: string | null };
    channel: { id: string; name: string; slug: string };
  }>;

  const users = (walletUsers || [])
    .map((u) => ({ id: u.id, displayName: u.displayName || u.id }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));

  const channels = Array.from(
    new Map(
      rows.map((w) => [
        w.channelId,
        { id: w.channelId, name: w.channel?.name || w.channelId, slug: w.channel?.slug || '' },
      ])
    ).values()
  ).sort((a, b) => a.name.localeCompare(b.name));

  const selectedUser = users.find((u) => u.id === selectedUserId) || null;
  const selectedChannel = channels.find((c) => c.id === selectedChannelId) || null;

  const isSelfUnlimitedPair = (w: { user: { displayName: string }; channel: { name: string; slug: string } }) => {
    const u = normalize(w.user?.displayName);
    const cName = normalize(w.channel?.name);
    const cSlug = normalize(w.channel?.slug);
    return !!u && (u === cName || u === cSlug);
  };

  const candidatePairsForUser = selectedUserId
    ? rows
        .filter((w) => w.userId === selectedUserId)
        .filter((w) => !isSelfUnlimitedPair(w))
        .sort((a, b) => (a.channel?.name || '').localeCompare(b.channel?.name || ''))
    : [];

  // Keep selection sane when data changes.

  useEffect(() => {
    if (!selectedUserId) return;
    const stillValid = candidatePairsForUser.some((p) => p.channelId === selectedChannelId);
    if (!stillValid) {
      setSelectedChannelId(candidatePairsForUser[0]?.channelId || '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedUserId, wallets.length]);

  const selectedPair =
    selectedUserId && selectedChannelId
      ? rows.find((w) => w.userId === selectedUserId && w.channelId === selectedChannelId) || null
      : null;

  const handleAdjust = async (userId: string, channelId: string) => {
    const raw = adjustAmount.trim();
    const amount = parseInt(raw, 10);
    if (isNaN(amount) || amount === 0) {
      toast.error(t('admin.enterAmount'));
      return;
    }

    try {
      setAdjusting(`${userId}-${channelId}`);
      const { api } = await import('@/lib/api');
      await api.post(`/owner/wallets/${userId}/${channelId}/adjust`, { amount });
      toast.success(amount > 0 ? t('admin.balanceIncreased', { amount: Math.abs(amount) }) : t('admin.balanceDecreased', { amount: Math.abs(amount) }));
      setAdjustAmount('');
      fetchWallets(userId, true);
    } catch (error: unknown) {
      const apiError = error as { response?: { data?: { error?: string } } };
      toast.error(apiError.response?.data?.error || t('admin.failedToAdjustBalance') || 'Failed to adjust balance');
    } finally {
      setAdjusting(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-3 py-10 text-gray-600 dark:text-gray-300">
        <Spinner className="h-5 w-5" />
        <span>{t('admin.loadingWallets', { defaultValue: 'Loading wallets…' })}</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-4">
        <h2 className="text-2xl font-bold mb-4 dark:text-white">{t('admin.walletManagement')}</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">
              {t('admin.user')}
            </div>
            <Select
              value={selectedUserId}
              onChange={(e) => {
                setSelectedUserId(e.target.value);
                setAdjustAmount('');
              }}
              className="bg-gray-50 dark:bg-gray-900/40"
            >
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.displayName}
                </option>
              ))}
            </Select>
          </div>

          <div>
            <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">
              {t('admin.channel') || 'Channel'}
            </div>
            <Select
              value={selectedChannelId}
              onChange={(e) => {
                setSelectedChannelId(e.target.value);
                setAdjustAmount('');
              }}
              className="bg-gray-50 dark:bg-gray-900/40"
              disabled={!selectedUserId || candidatePairsForUser.length === 0}
            >
              {candidatePairsForUser.length === 0 ? (
                <option value="">
                  {selectedUserId
                    ? t('admin.noWallets', { defaultValue: 'No wallets found' })
                    : t('admin.loadingWallets', { defaultValue: 'Loading wallets...' })}
                </option>
              ) : (
                candidatePairsForUser.map((p) => (
                  <option key={p.channelId} value={p.channelId}>
                    {p.channel?.name || p.channelId}
                  </option>
                ))
              )}
            </Select>
          </div>
        </div>

        <div className="mt-4 glass p-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="text-sm text-gray-800 dark:text-gray-100">
              <div className="font-semibold">
                {(selectedUser?.displayName || '') && (selectedChannel?.name || '')
                  ? `${selectedUser?.displayName} → ${selectedChannel?.name}`
                  : t('admin.walletManagement')}
              </div>
              <div className="text-xs text-gray-600 dark:text-gray-300 mt-0.5">
                {selectedPair
                  ? `${t('admin.balance') || 'Balance'}: ${selectedPair.balance} coins`
                  : t('admin.noWallets', { defaultValue: 'No wallets found' })}
              </div>
              {(selectedUser && selectedChannel) && (
                <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">
                  {t('admin.walletHint', { defaultValue: 'Tip: choose a viewer and a streamer channel — streamer self-wallets are hidden (unlimited).' })}
                </div>
              )}
            </div>

            <div className="flex gap-2 items-center">
              <Input
                inputMode="numeric"
                pattern="^-?\\d*$"
                value={adjustAmount}
                onChange={(e) => {
                  // Allow typing '-' and digits; prevent browser stepping behavior and keep UX stable.
                  const v = e.target.value;
                  if (/^-?\d*$/.test(v)) setAdjustAmount(v);
                }}
                placeholder={t('admin.amount')}
                className="w-28 bg-gray-50 dark:bg-gray-900/40"
                disabled={!selectedPair || adjusting !== null}
              />
              <Button
                type="button"
                onClick={() => selectedPair && handleAdjust(selectedPair.userId, selectedPair.channelId)}
                disabled={!selectedPair || adjusting !== null}
                variant="primary"
                size="sm"
              >
                {adjusting ? t('admin.adjusting', { defaultValue: 'Adjusting…' }) : t('admin.adjust', { defaultValue: 'Adjust' })}
              </Button>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-3 gap-2">
            <button
              type="button"
              className="rounded-xl bg-white/60 dark:bg-white/10 hover:bg-white/80 dark:hover:bg-white/15 px-3 py-2 text-xs text-gray-800 dark:text-gray-100"
              disabled={!selectedPair || adjusting !== null}
              onClick={() => setAdjustAmount((p) => String((parseInt(p || '0', 10) || 0) + 100))}
            >
              +100
            </button>
            <button
              type="button"
              className="rounded-xl bg-white/60 dark:bg-white/10 hover:bg-white/80 dark:hover:bg-white/15 px-3 py-2 text-xs text-gray-800 dark:text-gray-100"
              disabled={!selectedPair || adjusting !== null}
              onClick={() => setAdjustAmount((p) => String((parseInt(p || '0', 10) || 0) + 1000))}
            >
              +1000
            </button>
            <button
              type="button"
              className="rounded-xl bg-white/60 dark:bg-white/10 hover:bg-white/80 dark:hover:bg-white/15 px-3 py-2 text-xs text-gray-800 dark:text-gray-100"
              disabled={!selectedPair || adjusting !== null}
              onClick={() => setAdjustAmount('')}
            >
              {t('common.clear', { defaultValue: 'Clear' })}
            </button>
          </div>
        </div>

        <details className="mt-4">
          <summary className="cursor-pointer text-sm text-gray-700 dark:text-gray-200">
            {t('admin.allWallets', { defaultValue: 'All wallets (advanced)' })}
          </summary>
          <div className="overflow-x-auto mt-3">
            <table className="w-full">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  <th className="p-2">{t('admin.user')}</th>
                  <th className="p-2">{t('admin.channel') || 'Channel'}</th>
                  <th className="p-2">{t('admin.balance') || 'Balance'}</th>
                </tr>
              </thead>
              <tbody>
                {rows
                  .filter((w) => !isSelfUnlimitedPair(w))
                  .map((w) => (
                    <tr key={w.id} className="border-t border-gray-200/70 dark:border-white/10">
                      <td className="p-2 dark:text-gray-100">{w.user.displayName}</td>
                      <td className="p-2 dark:text-gray-100">{w.channel.name}</td>
                      <td className="p-2 font-bold dark:text-white">{w.balance} coins</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </details>
        {wallets.length === 0 && (
          <div className="text-center py-8 text-gray-500 dark:text-gray-400">{t('admin.noWallets')}</div>
        )}
      </div>
    </div>
  );
}


