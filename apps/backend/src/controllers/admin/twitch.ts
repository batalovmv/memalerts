import type { Response } from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { prisma } from '../../lib/prisma.js';
import { getChannelInformation } from '../../utils/twitchApi.js';
import { logger } from '../../utils/logger.js';
import { isBetaBackend } from '../../utils/envMode.js';

export const getTwitchRewardEligibility = async (req: AuthRequest, res: Response) => {
  const channelId = req.channelId;
  const userId = req.userId;

  if (!channelId || !userId) {
    return res.status(400).json({ error: 'Channel ID and User ID required' });
  }

  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
    select: { twitchChannelId: true },
  });

  if (!channel?.twitchChannelId) {
    return res.status(404).json({ error: 'Channel not found' });
  }

  try {
    const info = await getChannelInformation(userId, channel.twitchChannelId);
    // If Twitch returns no data (null), treat as "unknown" instead of "not eligible".
    if (!info) {
      logger.warn('twitch.eligibility.no_channel_info', {
        requestId: req.requestId,
        userId,
        channelId,
        broadcasterId: channel.twitchChannelId,
      });
      return res.json({
        eligible: null,
        broadcasterType: null,
        checkedBroadcasterId: channel.twitchChannelId,
        reason: 'TWITCH_CHANNEL_INFO_NOT_FOUND',
        ...(isBetaBackend()
          ? {
              debug: {
                tokenMode: null,
                itemKeys: null,
                rawBroadcasterType: null,
              },
            }
          : {}),
      });
    }
    const btRaw = info?.broadcaster_type;
    // Twitch uses empty string ("") when broadcaster is neither affiliate nor partner.
    // Null/undefined means we couldn't determine it (treat as unknown).
    if (btRaw === null || btRaw === undefined) {
      logger.warn('twitch.eligibility.missing_broadcaster_type', {
        requestId: req.requestId,
        userId,
        channelId,
        broadcasterId: channel.twitchChannelId,
      });
      return res.json({
        eligible: null,
        broadcasterType: null,
        checkedBroadcasterId: channel.twitchChannelId,
        reason: 'TWITCH_BROADCASTER_TYPE_MISSING',
        ...(isBetaBackend()
          ? {
              debug: {
                tokenMode: info?._meta?.tokenMode ?? null,
                itemKeys: info?._meta?.itemKeys ?? null,
                rawBroadcasterType: info?._meta?.rawBroadcasterType ?? null,
              },
            }
          : {}),
      });
    }

    const bt = String(btRaw).toLowerCase();
    const eligible = bt === 'affiliate' || bt === 'partner';
    return res.json({
      eligible,
      // Keep empty string as-is to make "not affiliate/partner" explicit to clients.
      broadcasterType: bt,
      checkedBroadcasterId: channel.twitchChannelId,
      reason: eligible ? undefined : 'TWITCH_REWARD_NOT_AVAILABLE',
      ...(isBetaBackend()
        ? {
            debug: {
              tokenMode: info?._meta?.tokenMode ?? null,
              itemKeys: info?._meta?.itemKeys ?? null,
              rawBroadcasterType: info?._meta?.rawBroadcasterType ?? null,
            },
          }
        : {}),
    });
  } catch (e: any) {
    logger.error('twitch.eligibility.failed', {
      requestId: req.requestId,
      userId,
      channelId,
      broadcasterId: channel.twitchChannelId,
      errorMessage: e?.message,
    });
    return res.status(502).json({
      error: e?.message || 'Failed to check Twitch channel eligibility',
      errorCode: 'TWITCH_ELIGIBILITY_CHECK_FAILED',
    });
  }
};


