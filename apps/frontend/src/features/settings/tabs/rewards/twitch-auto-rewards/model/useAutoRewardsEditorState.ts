import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { AutoRewardsEditorVariant, AutoRewardsEnabledKey, KvRow } from '@/features/settings/tabs/rewards/twitch-auto-rewards/model/types';
import type { TwitchAutoRewardsV1 } from '@memalerts/api-contracts';

import { base, bool, rowsFromRecord } from '@/features/settings/tabs/rewards/twitch-auto-rewards/model/utils';

type UseAutoRewardsEditorStateParams = {
  value: TwitchAutoRewardsV1 | null;
  onChange: (next: TwitchAutoRewardsV1 | null) => void;
  variant: AutoRewardsEditorVariant;
};

export function useAutoRewardsEditorState({ value, onChange, variant }: UseAutoRewardsEditorStateParams) {
  const v = useMemo(() => base(value), [value]);
  const dirtyRef = useRef(false);

  const [channelPointsRows, setChannelPointsRows] = useState<KvRow[]>(() => rowsFromRecord(v.channelPoints?.byRewardId));
  const [subscribeTierRows, setSubscribeTierRows] = useState<KvRow[]>(() => rowsFromRecord(v.subscribe?.tierCoins));
  const [resubTierRows, setResubTierRows] = useState<KvRow[]>(() => rowsFromRecord(v.resubMessage?.tierCoins));
  const [giftGiverTierRows, setGiftGiverTierRows] = useState<KvRow[]>(() => rowsFromRecord(v.giftSub?.giverTierCoins));
  const [thresholdCoinsRows, setThresholdCoinsRows] = useState<KvRow[]>(() => rowsFromRecord(v.chat?.messageThresholds?.coinsByThreshold));
  const [dailyStreakRows, setDailyStreakRows] = useState<KvRow[]>(() => rowsFromRecord(v.chat?.dailyStreak?.coinsByStreak));

  useEffect(() => {
    if (dirtyRef.current) return;
    const next = base(value);
    setChannelPointsRows(rowsFromRecord(next.channelPoints?.byRewardId));
    setSubscribeTierRows(rowsFromRecord(next.subscribe?.tierCoins));
    setResubTierRows(rowsFromRecord(next.resubMessage?.tierCoins));
    setGiftGiverTierRows(rowsFromRecord(next.giftSub?.giverTierCoins));
    setThresholdCoinsRows(rowsFromRecord(next.chat?.messageThresholds?.coinsByThreshold));
    setDailyStreakRows(rowsFromRecord(next.chat?.dailyStreak?.coinsByStreak));
  }, [value]);

  const isEnabled = useMemo(
    () => ({
      follow: bool(v.follow?.enabled),
      subscribe: bool(v.subscribe?.enabled),
      resubMessage: bool(v.resubMessage?.enabled),
      giftSub: bool(v.giftSub?.enabled),
      cheer: bool(v.cheer?.enabled),
      raid: bool(v.raid?.enabled),
      channelPoints: bool(v.channelPoints?.enabled),
      chatFirstMessage: bool(v.chat?.firstMessage?.enabled),
      chatThresholds: bool(v.chat?.messageThresholds?.enabled),
      chatDailyStreak: bool(v.chat?.dailyStreak?.enabled),
    }),
    [
      v.follow?.enabled,
      v.subscribe?.enabled,
      v.resubMessage?.enabled,
      v.giftSub?.enabled,
      v.cheer?.enabled,
      v.raid?.enabled,
      v.channelPoints?.enabled,
      v.chat?.firstMessage?.enabled,
      v.chat?.messageThresholds?.enabled,
      v.chat?.dailyStreak?.enabled,
    ],
  );

  const hasAnyEnabled = useMemo(() => {
    if (variant === 'channelPointsOnly') return isEnabled.channelPoints;
    if (variant === 'noChannelPoints') {
      const rest = Object.fromEntries(Object.entries(isEnabled).filter(([key]) => key !== 'channelPoints'));
      return Object.values(rest).some(Boolean);
    }
    return Object.values(isEnabled).some(Boolean);
  }, [isEnabled, variant]);

  const markDirty = useCallback(() => {
    dirtyRef.current = true;
  }, []);

  const patch = useCallback(
    (next: TwitchAutoRewardsV1) => {
      markDirty();
      onChange(next);
    },
    [markDirty, onChange],
  );

  const setEnabled = useCallback(
    (key: AutoRewardsEnabledKey, enabled: boolean) => {
      const cur = base(value);
      if (key === 'follow') patch({ ...cur, follow: { ...(cur.follow ?? {}), enabled } });
      if (key === 'subscribe') patch({ ...cur, subscribe: { ...(cur.subscribe ?? {}), enabled } });
      if (key === 'resubMessage') patch({ ...cur, resubMessage: { ...(cur.resubMessage ?? {}), enabled } });
      if (key === 'giftSub') patch({ ...cur, giftSub: { ...(cur.giftSub ?? {}), enabled } });
      if (key === 'cheer') patch({ ...cur, cheer: { ...(cur.cheer ?? {}), enabled } });
      if (key === 'raid') patch({ ...cur, raid: { ...(cur.raid ?? {}), enabled } });
      if (key === 'channelPoints') patch({ ...cur, channelPoints: { ...(cur.channelPoints ?? {}), enabled } });
      if (key === 'chatFirstMessage')
        patch({ ...cur, chat: { ...(cur.chat ?? {}), firstMessage: { ...(cur.chat?.firstMessage ?? {}), enabled } } });
      if (key === 'chatThresholds')
        patch({ ...cur, chat: { ...(cur.chat ?? {}), messageThresholds: { ...(cur.chat?.messageThresholds ?? {}), enabled } } });
      if (key === 'chatDailyStreak')
        patch({ ...cur, chat: { ...(cur.chat ?? {}), dailyStreak: { ...(cur.chat?.dailyStreak ?? {}), enabled } } });
    },
    [patch, value],
  );

  return {
    v,
    hasAnyEnabled,
    channelPointsRows,
    setChannelPointsRows,
    subscribeTierRows,
    setSubscribeTierRows,
    resubTierRows,
    setResubTierRows,
    giftGiverTierRows,
    setGiftGiverTierRows,
    thresholdCoinsRows,
    setThresholdCoinsRows,
    dailyStreakRows,
    setDailyStreakRows,
    markDirty,
    patch,
    setEnabled,
  };
}

