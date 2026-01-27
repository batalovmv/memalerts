import { useCallback, useState } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

import {
  ClaimDailyBonusResponseSchema,
  ClaimWatchBonusResponseSchema,
  type ChannelEconomy,
  type ClaimDailyBonusResponse,
  type ClaimWatchBonusResponse,
} from '@memalerts/api-contracts';
import type { ChannelInfo } from '@/features/streamer-profile/model/types';

import { api } from '@/lib/api';

export function useStreamerProfileEconomy(params: {
  channelInfo: ChannelInfo | null;
  setChannelInfo: (next: ChannelInfo | null | ((prev: ChannelInfo | null) => ChannelInfo | null)) => void;
  onWalletRefresh?: () => void;
}) {
  const { t } = useTranslation();
  const { channelInfo, setChannelInfo, onWalletRefresh } = params;
  const [claimingDaily, setClaimingDaily] = useState(false);
  const [claimingWatch, setClaimingWatch] = useState(false);

  const updateEconomy = useCallback(
    (economy: ChannelEconomy | undefined) => {
      if (!economy) return;
      setChannelInfo((prev) => (prev ? { ...prev, economy } : prev));
    },
    [setChannelInfo],
  );

  const claimDailyBonus = useCallback(async () => {
    if (!channelInfo?.slug) return;
    setClaimingDaily(true);
    try {
      const raw = await api.post<unknown>(`/channels/${channelInfo.slug}/bonuses/daily`);
      const resp: ClaimDailyBonusResponse = ClaimDailyBonusResponseSchema.parse(raw);
      updateEconomy(resp?.economy);
      if (resp?.bonusCoins) {
        toast.success(
          t('economy.dailyBonusClaimed', {
            defaultValue: 'Daily bonus: +{{count}} coins',
            count: resp.bonusCoins,
          }),
        );
      }
      if (resp?.startBonusCoins) {
        toast.success(
          t('economy.startBonusGranted', {
            defaultValue: 'Start bonus: +{{count}} coins',
            count: resp.startBonusCoins,
          }),
        );
      }
      onWalletRefresh?.();
    } catch (error: unknown) {
      const apiError = error as { response?: { data?: { error?: string; errorCode?: string } } };
      const message = apiError.response?.data?.error || t('toast.failedToClaim', { defaultValue: 'Failed to claim bonus' });
      toast.error(message);
    } finally {
      setClaimingDaily(false);
    }
  }, [channelInfo?.slug, onWalletRefresh, t, updateEconomy]);

  const claimWatchBonus = useCallback(async () => {
    if (!channelInfo?.slug) return;
    setClaimingWatch(true);
    try {
      const raw = await api.post<unknown>(`/channels/${channelInfo.slug}/bonuses/watch`);
      const resp: ClaimWatchBonusResponse = ClaimWatchBonusResponseSchema.parse(raw);
      updateEconomy(resp?.economy);
      if (resp?.bonusCoins) {
        toast.success(
          t('economy.watchBonusClaimed', {
            defaultValue: 'Watch bonus: +{{count}} coins',
            count: resp.bonusCoins,
          }),
        );
      }
      if (resp?.startBonusCoins) {
        toast.success(
          t('economy.startBonusGranted', {
            defaultValue: 'Start bonus: +{{count}} coins',
            count: resp.startBonusCoins,
          }),
        );
      }
      onWalletRefresh?.();
    } catch (error: unknown) {
      const apiError = error as { response?: { data?: { error?: string; errorCode?: string } } };
      const message = apiError.response?.data?.error || t('toast.failedToClaim', { defaultValue: 'Failed to claim bonus' });
      toast.error(message);
    } finally {
      setClaimingWatch(false);
    }
  }, [channelInfo?.slug, onWalletRefresh, t, updateEconomy]);

  return {
    claimingDaily,
    claimingWatch,
    claimDailyBonus,
    claimWatchBonus,
  };
}
