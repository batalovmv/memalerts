import { useCallback, useEffect, useRef, useState } from 'react';

import type { ChannelInfo } from '@/features/streamer-profile/model/types';
import type { AppDispatch } from '@/store';
import type { User, Wallet } from '@memalerts/api-contracts';
import type { MutableRefObject } from 'react';

import { api } from '@/lib/api';
import { updateWalletBalance } from '@/store/slices/authSlice';

type UseStreamerProfileWalletParams = {
  user: User | null;
  channelInfo: ChannelInfo | null;
  dispatch: AppDispatch;
};

export function useStreamerProfileWallet({ user, channelInfo, dispatch }: UseStreamerProfileWalletParams) {
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const lastWalletChannelRef: MutableRefObject<string | null> = useRef(null);

  const syncWalletFromUser = useCallback(() => {
    if (!user?.wallets || !channelInfo) return;
    const userWallet = user.wallets.find((w) => w.channelId === channelInfo.id);
    if (userWallet && (!wallet || userWallet.balance !== wallet.balance)) {
      setWallet(userWallet);
    }
  }, [channelInfo, user?.wallets, wallet]);

  // Load wallet on channel change (and when user logs in).
  useEffect(() => {
    if (!channelInfo?.id || !channelInfo.slug) {
      lastWalletChannelRef.current = null;
      setWallet(null);
      return;
    }
    if (!user) {
      setWallet(null);
      return;
    }

    const channelId = channelInfo.id;
    if (lastWalletChannelRef.current === channelId) {
      syncWalletFromUser();
      return;
    }
    lastWalletChannelRef.current = channelId;

    // Use user.wallets from Redux first (Socket.IO will update it automatically).
    const userWallet = user.wallets?.find((w) => w.channelId === channelId);
    if (userWallet) {
      setWallet(userWallet);
      return;
    }

    // Only fetch if wallet not in Redux.
    (async () => {
      try {
        const next = await api.get<Wallet>(`/channels/${channelInfo.slug}/wallet`, {
          timeout: 10000, // 10 second timeout
        });
        setWallet(next);
        dispatch(updateWalletBalance({ channelId: next.channelId, balance: next.balance }));
      } catch (error: unknown) {
        const apiError = error as { response?: { status?: number }; code?: string };
        // If wallet doesn't exist or times out, set default wallet.
        if (
          apiError.response?.status === 404 ||
          apiError.code === 'ECONNABORTED' ||
          apiError.response?.status === 504 ||
          apiError.response?.status === 500
        ) {
          setWallet({
            id: '',
            userId: user.id,
            channelId: channelInfo.id,
            balance: 0,
          });
        }
      }
    })();
  }, [channelInfo?.id, channelInfo?.slug, dispatch, syncWalletFromUser, user]);

  // Sync wallet from user.wallets when Redux store updates (e.g., via Socket.IO).
  useEffect(() => {
    syncWalletFromUser();
  }, [syncWalletFromUser, user?.wallets]);

  const refreshWallet = useCallback(async () => {
    if (!user || !channelInfo?.slug) return;
    try {
      const next = await api.get<Wallet>(`/channels/${channelInfo.slug}/wallet`, { timeout: 10000 });
      setWallet(next);
      dispatch(updateWalletBalance({ channelId: next.channelId, balance: next.balance }));
    } catch {
      // ignore
    }
  }, [channelInfo?.slug, dispatch, user]);

  return {
    wallet,
    refreshWallet,
    syncWalletFromUser,
  };
}

