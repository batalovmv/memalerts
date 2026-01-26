import type { TwitchAutoRewardsV1 } from '@memalerts/api-contracts';

export type KvRow = { key: string; value: string };

export type PlatformCode = 'TW' | 'K' | 'TR' | 'VK';

export type AutoRewardsEditorVariant = 'all' | 'noChannelPoints' | 'channelPointsOnly';

export type AutoRewardsEnabledKey =
  | 'follow'
  | 'subscribe'
  | 'resubMessage'
  | 'giftSub'
  | 'cheer'
  | 'raid'
  | 'channelPoints'
  | 'chatFirstMessage'
  | 'chatThresholds'
  | 'chatDailyStreak';

export type AutoRewardsEditorProps = {
  value: TwitchAutoRewardsV1 | null;
  onChange: (next: TwitchAutoRewardsV1 | null) => void;
  disabled?: boolean;
  variant?: AutoRewardsEditorVariant;
};

