import type { Channel } from '@prisma/client';
import { normalizeDashboardCardOrder } from '../../../utils/dashboardCardOrder.js';
import { asRecord, type UpdateChannelSettingsBody } from './shared.js';

export function buildChannelUpdateData(params: {
  channel: Channel;
  body: UpdateChannelSettingsBody;
  bodyRec: Record<string, unknown>;
  rewardIdForCoinsOverride: string | null;
  kickRewardsSubscriptionIdToSave: string | undefined;
  coinIconUrl: string | null;
}) {
  const { channel, body, bodyRec, rewardIdForCoinsOverride, kickRewardsSubscriptionIdToSave, coinIconUrl } = params;
  const channelRec = asRecord(channel);
  const channelRewardIdForCoins = typeof channelRec.rewardIdForCoins === 'string' ? channelRec.rewardIdForCoins : null;

  const updateData: Record<string, unknown> = {
    rewardIdForCoins: rewardIdForCoinsOverride ?? channelRewardIdForCoins,
    coinPerPointRatio: body.coinPerPointRatio !== undefined ? body.coinPerPointRatio : channel.coinPerPointRatio,
    rewardEnabled: body.rewardEnabled !== undefined ? body.rewardEnabled : channelRec.rewardEnabled,
    rewardTitle: body.rewardTitle !== undefined ? body.rewardTitle : channelRec.rewardTitle,
    rewardCost: body.rewardCost !== undefined ? body.rewardCost : channelRec.rewardCost,
    rewardCoins: body.rewardCoins !== undefined ? body.rewardCoins : channelRec.rewardCoins,
    rewardOnlyWhenLive:
      bodyRec.rewardOnlyWhenLive !== undefined ? bodyRec.rewardOnlyWhenLive : channelRec.rewardOnlyWhenLive,
    kickRewardEnabled:
      bodyRec.kickRewardEnabled !== undefined ? bodyRec.kickRewardEnabled : channelRec.kickRewardEnabled,
    kickRewardsSubscriptionId:
      kickRewardsSubscriptionIdToSave !== undefined
        ? kickRewardsSubscriptionIdToSave
        : channelRec.kickRewardsSubscriptionId,
    kickRewardIdForCoins:
      bodyRec.kickRewardIdForCoins !== undefined ? bodyRec.kickRewardIdForCoins : channelRec.kickRewardIdForCoins,
    kickCoinPerPointRatio:
      bodyRec.kickCoinPerPointRatio !== undefined ? bodyRec.kickCoinPerPointRatio : channelRec.kickCoinPerPointRatio,
    kickRewardCoins: bodyRec.kickRewardCoins !== undefined ? bodyRec.kickRewardCoins : channelRec.kickRewardCoins,
    kickRewardOnlyWhenLive:
      bodyRec.kickRewardOnlyWhenLive !== undefined ? bodyRec.kickRewardOnlyWhenLive : channelRec.kickRewardOnlyWhenLive,
    trovoManaCoinsPerUnit:
      bodyRec.trovoManaCoinsPerUnit !== undefined ? bodyRec.trovoManaCoinsPerUnit : channelRec.trovoManaCoinsPerUnit,
    trovoElixirCoinsPerUnit:
      bodyRec.trovoElixirCoinsPerUnit !== undefined
        ? bodyRec.trovoElixirCoinsPerUnit
        : channelRec.trovoElixirCoinsPerUnit,
    vkvideoRewardEnabled:
      bodyRec.vkvideoRewardEnabled !== undefined ? bodyRec.vkvideoRewardEnabled : channelRec.vkvideoRewardEnabled,
    vkvideoRewardIdForCoins:
      bodyRec.vkvideoRewardIdForCoins !== undefined
        ? bodyRec.vkvideoRewardIdForCoins
        : channelRec.vkvideoRewardIdForCoins,
    vkvideoCoinPerPointRatio:
      bodyRec.vkvideoCoinPerPointRatio !== undefined
        ? bodyRec.vkvideoCoinPerPointRatio
        : channelRec.vkvideoCoinPerPointRatio,
    vkvideoRewardCoins:
      bodyRec.vkvideoRewardCoins !== undefined ? bodyRec.vkvideoRewardCoins : channelRec.vkvideoRewardCoins,
    vkvideoRewardOnlyWhenLive:
      bodyRec.vkvideoRewardOnlyWhenLive !== undefined
        ? bodyRec.vkvideoRewardOnlyWhenLive
        : channelRec.vkvideoRewardOnlyWhenLive,
    youtubeLikeRewardEnabled:
      bodyRec.youtubeLikeRewardEnabled !== undefined
        ? bodyRec.youtubeLikeRewardEnabled
        : channelRec.youtubeLikeRewardEnabled,
    youtubeLikeRewardCoins:
      bodyRec.youtubeLikeRewardCoins !== undefined ? bodyRec.youtubeLikeRewardCoins : channelRec.youtubeLikeRewardCoins,
    youtubeLikeRewardOnlyWhenLive:
      bodyRec.youtubeLikeRewardOnlyWhenLive !== undefined
        ? bodyRec.youtubeLikeRewardOnlyWhenLive
        : channelRec.youtubeLikeRewardOnlyWhenLive,
    twitchAutoRewardsJson:
      bodyRec.twitchAutoRewards !== undefined ? bodyRec.twitchAutoRewards : channelRec.twitchAutoRewardsJson,
    submissionRewardCoins:
      body.submissionRewardCoins !== undefined ? body.submissionRewardCoins : channelRec.submissionRewardCoins,
    submissionRewardCoinsUpload:
      bodyRec.submissionRewardCoinsUpload !== undefined
        ? bodyRec.submissionRewardCoinsUpload
        : channelRec.submissionRewardCoinsUpload,
    submissionRewardCoinsPool:
      bodyRec.submissionRewardCoinsPool !== undefined
        ? bodyRec.submissionRewardCoinsPool
        : channelRec.submissionRewardCoinsPool,
    submissionRewardOnlyWhenLive:
      bodyRec.submissionRewardOnlyWhenLive !== undefined
        ? bodyRec.submissionRewardOnlyWhenLive
        : channelRec.submissionRewardOnlyWhenLive,
    submissionsEnabled:
      bodyRec.submissionsEnabled !== undefined ? bodyRec.submissionsEnabled : channelRec.submissionsEnabled,
    submissionsOnlyWhenLive:
      bodyRec.submissionsOnlyWhenLive !== undefined
        ? bodyRec.submissionsOnlyWhenLive
        : channelRec.submissionsOnlyWhenLive,
    primaryColor: body.primaryColor !== undefined ? body.primaryColor : channelRec.primaryColor,
    secondaryColor: body.secondaryColor !== undefined ? body.secondaryColor : channelRec.secondaryColor,
    accentColor: body.accentColor !== undefined ? body.accentColor : channelRec.accentColor,
    overlayMode: body.overlayMode !== undefined ? body.overlayMode : channelRec.overlayMode,
    overlayShowSender: body.overlayShowSender !== undefined ? body.overlayShowSender : channelRec.overlayShowSender,
    overlayMaxConcurrent:
      body.overlayMaxConcurrent !== undefined ? body.overlayMaxConcurrent : channelRec.overlayMaxConcurrent,
    overlayStyleJson: body.overlayStyleJson !== undefined ? body.overlayStyleJson : channelRec.overlayStyleJson,
    memeCatalogMode: bodyRec.memeCatalogMode !== undefined ? bodyRec.memeCatalogMode : channelRec.memeCatalogMode,
    boostyBlogName: bodyRec.boostyBlogName !== undefined ? bodyRec.boostyBlogName : channelRec.boostyBlogName,
    boostyCoinsPerSub:
      bodyRec.boostyCoinsPerSub !== undefined ? bodyRec.boostyCoinsPerSub : channelRec.boostyCoinsPerSub,
    boostyTierCoinsJson:
      bodyRec.boostyTierCoins !== undefined ? bodyRec.boostyTierCoins : channelRec.boostyTierCoinsJson,
    boostyDiscordTierRolesJson:
      bodyRec.boostyDiscordTierRoles !== undefined
        ? bodyRec.boostyDiscordTierRoles
        : channelRec.boostyDiscordTierRolesJson,
    discordSubscriptionsGuildId:
      bodyRec.discordSubscriptionsGuildId !== undefined
        ? bodyRec.discordSubscriptionsGuildId
        : channelRec.discordSubscriptionsGuildId,
  };

  if (bodyRec.dashboardCardOrder !== undefined) {
    const v = bodyRec.dashboardCardOrder;
    updateData.dashboardCardOrder = v === null ? null : normalizeDashboardCardOrder(v);
  }

  if (coinIconUrl !== null || body.rewardEnabled === false) {
    updateData.coinIconUrl = body.rewardEnabled === false ? null : coinIconUrl;
  }

  return updateData;
}
