import type { BotProvider, MemeCatalogMode } from './common';
import type {
  KickAutoRewardsV1,
  TrovoAutoRewardsV1,
  TwitchAutoRewardsV1,
  VkVideoAutoRewardsV1,
  YouTubeAutoRewardsV1,
} from './autoRewards';

export interface CreditsEntry {
  displayName: string;
  amount?: number;
  message?: string;
}

export interface CreditsState {
  donors: CreditsEntry[];
  chatters: CreditsEntry[];
}

export interface CreditsStyleJson {
  backgroundColor?: string;
  textColor?: string;
  fontSize?: number;
  fontFamily?: string;
  [key: string]: unknown;
}

export interface BotIntegrationSettings {
  provider: BotProvider;
  enabled: boolean;
  useDefaultBot: boolean;
  channelUrl?: string | null;
}

export type EntitlementType = 'custom_bot' | 'extended_overlay' | 'priority_ai';

export interface ChannelEntitlement {
  id: string;
  channelId: string;
  type: EntitlementType;
  grantedBy: string;
  grantedAt: string;
  expiresAt?: string | null;
}

export interface ChannelSettings {
  rewardIdForCoins?: string | null;
  coinPerPointRatio?: number;
  rewardEnabled?: boolean;
  rewardTitle?: string | null;
  rewardCost?: number | null;
  rewardCoins?: number | null;
  rewardOnlyWhenLive?: boolean;
  kickRewardEnabled?: boolean;
  kickRewardIdForCoins?: string | null;
  kickCoinPerPointRatio?: number;
  kickRewardCoins?: number | null;
  kickRewardOnlyWhenLive?: boolean;
  trovoManaCoinsPerUnit?: number;
  trovoElixirCoinsPerUnit?: number;
  vkvideoRewardEnabled?: boolean;
  vkvideoRewardIdForCoins?: string | null;
  vkvideoCoinPerPointRatio?: number;
  vkvideoRewardCoins?: number | null;
  vkvideoRewardOnlyWhenLive?: boolean;
  youtubeLikeRewardEnabled?: boolean;
  youtubeLikeRewardCoins?: number;
  youtubeLikeRewardOnlyWhenLive?: boolean;
  twitchAutoRewards?: TwitchAutoRewardsV1 | null;
  submissionRewardCoins?: number;
  submissionRewardCoinsUpload?: number;
  submissionRewardCoinsPool?: number;
  submissionRewardOnlyWhenLive?: boolean;
  submissionsEnabled?: boolean;
  submissionsOnlyWhenLive?: boolean;
  autoApproveEnabled?: boolean;
  dynamicPricingEnabled?: boolean;
  dynamicPricingMinMult?: number;
  dynamicPricingMaxMult?: number;
  primaryColor?: string | null;
  secondaryColor?: string | null;
  accentColor?: string | null;
  overlayMode?: 'queue' | 'simultaneous';
  overlayShowSender?: boolean;
  overlayMaxConcurrent?: number;
  overlayStyleJson?: string | null;
  memeCatalogMode?: MemeCatalogMode;
  dashboardCardOrder?: string[] | null;
  boostyBlogName?: string | null;
  boostyCoinsPerSub?: number;
  discordSubscriptionsGuildId?: string | null;
  boostyTierCoins?: Array<{ tierKey: string; coins: number }> | null;
  boostyDiscordTierRoles?: Array<{ tier: string; roleId: string }> | null;
}

export interface Channel {
  id: string;
  slug: string;
  name: string;
  /**
   * Which meme catalog is shown on the public channel page.
   * - channel: only channel-approved memes (ChannelMeme)
   * - pool_all: full global pool (MemeAsset); activation requires channelSlug/channelId context
   */
  memeCatalogMode?: MemeCatalogMode;
  /**
   * Twitch broadcaster id if the channel is linked to Twitch.
   * When null/undefined, Twitch-only features must be disabled in UI.
   */
  twitchChannelId?: string | null;
  /**
   * Reward coins for approved submissions, split by source kind (upload/url vs pool).
   * Back-compat: older backend may only provide `submissionRewardCoins`.
   */
  submissionRewardCoinsUpload?: number;
  submissionRewardCoinsPool?: number;
  submissionRewardCoins?: number;
  autoApproveEnabled?: boolean;
  dynamicPricingEnabled?: boolean;
  dynamicPricingMinMult?: number;
  dynamicPricingMaxMult?: number;
  overlayStyleJson?: string | null;
  creditsStyleJson?: string | null;
  botIntegrations?: BotIntegrationSettings[];
  twitchAutoRewardsJson?: TwitchAutoRewardsV1 | null;
  kickAutoRewardsJson?: KickAutoRewardsV1 | null;
  trovoAutoRewardsJson?: TrovoAutoRewardsV1 | null;
  vkvideoAutoRewardsJson?: VkVideoAutoRewardsV1 | null;
  youtubeAutoRewardsJson?: YouTubeAutoRewardsV1 | null;
}
