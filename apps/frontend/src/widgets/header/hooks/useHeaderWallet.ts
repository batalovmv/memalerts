import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';

import type { Wallet } from '@memalerts/api-contracts';

import { useSocket } from '@/contexts/SocketContext';
import { api } from '@/lib/api';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { updateWalletBalance } from '@/store/slices/authSlice';

type WalletUpdate = {
  userId: string;
  channelId: string;
  balance: number;
  delta?: number;
  reason?: string;
};

export function useHeaderWallet(channelSlug?: string, channelId?: string) {
  const { user } = useAppSelector((state) => state.auth);
  const userId = user?.id;
  const userChannelId = user?.channelId;
  const userChannelSlug = user?.channel?.slug;
  const userWallets = user?.wallets;
  const location = useLocation();
  const params = useParams<{ slug: string }>();
  const currentChannelSlug = channelSlug || params.slug;
  const dispatch = useAppDispatch();
  const { isConnected } = useSocket();

  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [isLoadingWallet, setIsLoadingWallet] = useState(false);
  const [coinUpdateDelta, setCoinUpdateDelta] = useState<number | null>(null);
  const coinUpdateHideTimerRef = useRef<number | null>(null);
  const walletLoadedRef = useRef<string | null>(null);
  const lastWalletFetchAtRef = useRef<number>(0);
  const walletFetchInFlightRef = useRef(false);

  const clearCoinUpdateDelta = useCallback(() => setCoinUpdateDelta(null), []);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (coinUpdateHideTimerRef.current) {
        window.clearTimeout(coinUpdateHideTimerRef.current);
        coinUpdateHideTimerRef.current = null;
      }
    };
  }, []);

  // Load wallet balance and auto-refresh
  // Skip wallet loading if we're on a channel page - wallet is loaded by StreamerProfile
  useEffect(() => {
    if (!userId) {
      setWallet(null);
      walletLoadedRef.current = null;
      return;
    }

    const isChannelPage = location.pathname.startsWith('/channel/');
    if (isChannelPage) {
      if (channelId && userWallets) {
        const userWallet = userWallets.find((w) => w.channelId === channelId);
        if (userWallet) {
          setWallet(userWallet);
        }
      }
      walletLoadedRef.current = null;
      return;
    }

    const targetChannelSlug = currentChannelSlug || userChannelSlug;
    const targetChannelId = channelId || userChannelId;

    if (targetChannelId && userWallets) {
      const userWallet = userWallets.find((w) => w.channelId === targetChannelId);
      if (userWallet) {
        setWallet(userWallet);
        walletLoadedRef.current = targetChannelSlug || null;
        return;
      }
    }

    if (walletLoadedRef.current === targetChannelSlug) {
      return;
    }

    const loadWallet = async () => {
      const WALLET_REFRESH_TTL_MS = 30_000;
      const now = Date.now();
      if (walletFetchInFlightRef.current) return;
      if (now - lastWalletFetchAtRef.current < WALLET_REFRESH_TTL_MS) return;

      setIsLoadingWallet(true);
      walletFetchInFlightRef.current = true;
      lastWalletFetchAtRef.current = now;
      try {
        if (targetChannelSlug) {
          try {
            const wallet = await api.get<Wallet>(`/channels/${targetChannelSlug}/wallet`, {
              timeout: 10000,
            });
            setWallet(wallet);
            walletLoadedRef.current = targetChannelSlug || null;
            if (targetChannelId && wallet.channelId === targetChannelId) {
              dispatch(updateWalletBalance({ channelId: targetChannelId, balance: wallet.balance }));
            }
          } catch (error: unknown) {
            const apiError = error as { response?: { status?: number }; code?: string };
            if (apiError.response?.status === 404 || apiError.code === 'ECONNABORTED') {
              if (targetChannelId) {
                setWallet({
                  id: '',
                  userId,
                  channelId: targetChannelId,
                  balance: 0,
                });
                walletLoadedRef.current = targetChannelSlug || null;
              }
            }
            console.warn('Failed to load wallet:', error);
          }
        }
      } catch (error) {
        console.error('Error loading wallet:', error);
      } finally {
        setIsLoadingWallet(false);
        walletFetchInFlightRef.current = false;
      }
    };

    void loadWallet();

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && !isChannelPage) {
        void loadWallet();
      }
    };

    const handleFocus = () => {
      if (!isChannelPage) {
        void loadWallet();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
    };
  }, [
    userId,
    userChannelId,
    userChannelSlug,
    userWallets,
    currentChannelSlug,
    channelId,
    dispatch,
    location.pathname,
    isConnected,
  ]);

  const handleWalletUpdate = useCallback(
    (data: WalletUpdate) => {
      if (data.userId !== userId) return;
      if (channelId && data.channelId !== channelId) return;

      setWallet((prev) => {
        const prevBalance = prev?.channelId === data.channelId ? prev.balance : prev?.balance ?? 0;
        const delta = typeof data.delta === 'number' ? data.delta : data.balance - prevBalance;

        if (delta > 0 && (data.reason === 'twitch_reward' || data.reason === undefined)) {
          setCoinUpdateDelta((prevDelta) => (prevDelta ?? 0) + delta);

          if (coinUpdateHideTimerRef.current) {
            window.clearTimeout(coinUpdateHideTimerRef.current);
          }
          coinUpdateHideTimerRef.current = window.setTimeout(() => {
            setCoinUpdateDelta(null);
            coinUpdateHideTimerRef.current = null;
          }, 8000);
        }

        if (prev && prev.channelId === data.channelId) {
          return { ...prev, balance: data.balance };
        }

        return {
          id: '',
          userId: data.userId,
          channelId: data.channelId,
          balance: data.balance,
        };
      });
    },
    [channelId, userId],
  );

  return {
    wallet,
    isLoadingWallet,
    coinUpdateDelta,
    clearCoinUpdateDelta,
    handleWalletUpdate,
  };
}

