import type { Response } from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { ZodError } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { updateChannelSettingsSchema } from '../../shared/schemas.js';
import { logger } from '../../utils/logger.js';
import { handleKickRewardToggle } from './channelSettings/kickRewards.js';
import { handleTwitchRewardSettings } from './channelSettings/twitchRewards.js';
import { buildChannelUpdateData } from './channelSettings/updateData.js';
import { ensureTwitchAutoRewardsEventSubs } from './channelSettings/twitchAutoRewardsEventSub.js';
import {
  emitOverlayConfig,
  emitSubmissionsStatus,
  invalidateCatalogCacheOnModeChange,
  invalidateChannelMetaCache,
} from './channelSettings/emitters.js';
import { asRecord, getErrorMessage } from './channelSettings/shared.js';

type HttpErrorLike = {
  status?: number;
  errorCode?: string;
  requiresReauth?: boolean;
  details?: unknown;
  message?: string;
};

function tryHandleStatusError(res: Response, error: unknown): boolean {
  const err = error as HttpErrorLike;
  if (typeof err.status !== 'number') return false;
  const payload: Record<string, unknown> = {
    error: err.message || 'Request failed',
  };
  if (err.errorCode) payload.errorCode = err.errorCode;
  if (err.requiresReauth) payload.requiresReauth = true;
  if (err.details !== undefined) payload.details = err.details;
  res.status(err.status).json(payload);
  return true;
}

export const updateChannelSettings = async (req: AuthRequest, res: Response) => {
  const channelId = req.channelId;
  const userId = req.userId;

  if (!channelId || !userId) {
    return res.status(400).json({ error: 'Channel ID and User ID required' });
  }

  try {
    const body = updateChannelSettingsSchema.parse(req.body);
    const bodyRec = asRecord(body);

    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
    });

    if (!channel) {
      return res.status(404).json({ error: 'Channel not found' });
    }

    const channelRec = asRecord(channel);

    let kickRewardsSubscriptionIdToSave: string | undefined = undefined;
    try {
      kickRewardsSubscriptionIdToSave = await handleKickRewardToggle({ req, userId, channel, bodyRec });
    } catch (error) {
      if (tryHandleStatusError(res, error)) return;
      throw error;
    }

    let rewardIdForCoinsOverride: string | null = null;
    let coinIconUrl: string | null = null;
    try {
      const rewardResult = await handleTwitchRewardSettings({ req, userId, channelId, channel, body, bodyRec });
      rewardIdForCoinsOverride = rewardResult.rewardIdForCoinsOverride;
      coinIconUrl = rewardResult.coinIconUrl;
    } catch (error) {
      if (tryHandleStatusError(res, error)) return;
      throw error;
    }

    const updateData = buildChannelUpdateData({
      channel,
      body,
      bodyRec,
      rewardIdForCoinsOverride,
      kickRewardsSubscriptionIdToSave,
      coinIconUrl,
    });

    const updatedChannel = await prisma.channel.update({
      where: { id: channelId },
      data: updateData,
    });

    invalidateCatalogCacheOnModeChange({ bodyRec, channelRec });

    await ensureTwitchAutoRewardsEventSubs({ req, channel, updateData });

    const updatedChannelRec = asRecord(updatedChannel);
    invalidateChannelMetaCache({ updatedChannel: updatedChannelRec, channelRec });
    emitSubmissionsStatus({ req, updatedChannel: updatedChannelRec, channelRec });
    emitOverlayConfig({ req, updatedChannel: updatedChannelRec, channelRec });

    return res.json(updatedChannel);
  } catch (error: unknown) {
    logger.error('admin.channel_settings.update_failed', { errorMessage: getErrorMessage(error) });
    if (error instanceof ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: error.errors });
    }
    return res.status(500).json({ error: getErrorMessage(error) || 'Failed to update channel settings' });
  }
};
