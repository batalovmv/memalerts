import type { Channel } from '@prisma/client';
import { normalizeDashboardCardOrder } from '../../../utils/dashboardCardOrder.js';
import { asRecord, type UpdateChannelSettingsBody } from './shared.js';

export function buildChannelUpdateData(params: {
  channel: Channel;
  body: UpdateChannelSettingsBody;
  bodyRec: Record<string, unknown>;
  rewardIdForCoinsOverride: string | null;
  coinIconUrl: string | null;
}) {
  const { channel, body, bodyRec, rewardIdForCoinsOverride, coinIconUrl } = params;
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
    autoApproveEnabled:
      bodyRec.autoApproveEnabled !== undefined ? bodyRec.autoApproveEnabled : channelRec.autoApproveEnabled,
    primaryColor: body.primaryColor !== undefined ? body.primaryColor : channelRec.primaryColor,
    secondaryColor: body.secondaryColor !== undefined ? body.secondaryColor : channelRec.secondaryColor,
    accentColor: body.accentColor !== undefined ? body.accentColor : channelRec.accentColor,
    overlayMode: body.overlayMode !== undefined ? body.overlayMode : channelRec.overlayMode,
    overlayShowSender: body.overlayShowSender !== undefined ? body.overlayShowSender : channelRec.overlayShowSender,
    overlayMaxConcurrent:
      body.overlayMaxConcurrent !== undefined ? body.overlayMaxConcurrent : channelRec.overlayMaxConcurrent,
    overlayStyleJson: body.overlayStyleJson !== undefined ? body.overlayStyleJson : channelRec.overlayStyleJson,
    economyMemesPerHour:
      bodyRec.economyMemesPerHour !== undefined ? bodyRec.economyMemesPerHour : channelRec.economyMemesPerHour,
    economyRewardMultiplier:
      bodyRec.economyRewardMultiplier !== undefined ? bodyRec.economyRewardMultiplier : channelRec.economyRewardMultiplier,
    economyApprovalBonusCoins:
      bodyRec.economyApprovalBonusCoins !== undefined ? bodyRec.economyApprovalBonusCoins : channelRec.economyApprovalBonusCoins,
    defaultPriceCoins:
      bodyRec.defaultPriceCoins !== undefined ? bodyRec.defaultPriceCoins : channelRec.defaultPriceCoins,
    memeCatalogMode: bodyRec.memeCatalogMode !== undefined ? bodyRec.memeCatalogMode : channelRec.memeCatalogMode,
  };

  if (bodyRec.dashboardCardOrder !== undefined) {
    const v = bodyRec.dashboardCardOrder;
    updateData.dashboardCardOrder = v === null ? null : normalizeDashboardCardOrder(v);
  }

  if (coinIconUrl !== null || body.rewardEnabled === false) {
    updateData.coinIconUrl = body.rewardEnabled === false ? null : coinIconUrl;
  }

  if (bodyRec.economyApprovalBonusCoins === undefined) {
    const bonusCandidate =
      typeof bodyRec.submissionRewardCoinsUpload === 'number'
        ? bodyRec.submissionRewardCoinsUpload
        : typeof bodyRec.submissionRewardCoins === 'number'
          ? bodyRec.submissionRewardCoins
          : undefined;
    if (typeof bonusCandidate === 'number') {
      updateData.economyApprovalBonusCoins = bonusCandidate;
    }
  }

  return updateData;
}
