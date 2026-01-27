import type { Response } from 'express';
import type { AuthRequest } from '../../middleware/auth.js';

import { CreateVoteBodySchema, CloseVoteParamsSchema } from '@memalerts/api-contracts';

import { prisma } from '../../lib/prisma.js';
import { ERROR_CODES } from '../../shared/errors.js';
import { emitWalletUpdated, relayWalletUpdatedToPeer, type WalletUpdatedEvent } from '../../realtime/walletBridge.js';
import { createVoteSession, getActiveVoteSession, closeVoteSession } from '../../services/vote/voteService.js';

async function getChannelSlug(channelId: string): Promise<string | null> {
  const channel = await prisma.channel.findUnique({ where: { id: channelId }, select: { slug: true } });
  const slug = String(channel?.slug || '').toLowerCase();
  return slug || null;
}

function emitVoteUpdate(app: AuthRequest['app'], slug: string, payload: unknown) {
  const io = app.get('io');
  io.to(`channel:${slug}`).emit('vote:updated', payload);
  io.to(`public:${slug}`).emit('vote:updated', payload);
}

export const getActiveVote = async (req: AuthRequest, res: Response) => {
  const channelId = req.channelId;
  if (!channelId) {
    return res.status(400).json({ errorCode: ERROR_CODES.MISSING_CHANNEL_ID, error: 'Missing channelId' });
  }

  const session = await getActiveVoteSession(channelId);
  return res.json({ session });
};

export const createVote = async (req: AuthRequest, res: Response) => {
  const channelId = req.channelId;
  if (!channelId) {
    return res.status(400).json({ errorCode: ERROR_CODES.MISSING_CHANNEL_ID, error: 'Missing channelId' });
  }

  try {
    const body = CreateVoteBodySchema.parse(req.body ?? {});
    const session = await createVoteSession({
      channelId,
      createdByUserId: req.userId ?? null,
      channelMemeIds: body.channelMemeIds,
      durationSeconds: body.durationSeconds,
    });
    if (!session) {
      return res.status(409).json({ errorCode: ERROR_CODES.CONFLICT, error: 'Unable to start vote' });
    }

    const slug = await getChannelSlug(channelId);
    if (slug) {
      emitVoteUpdate(req.app, slug, { session });
    }

    return res.json({ session });
  } catch (error: unknown) {
    return res.status(400).json({ errorCode: ERROR_CODES.BAD_REQUEST, error: 'Invalid vote payload' });
  }
};

export const closeVote = async (req: AuthRequest, res: Response) => {
  const channelId = req.channelId;
  if (!channelId) {
    return res.status(400).json({ errorCode: ERROR_CODES.MISSING_CHANNEL_ID, error: 'Missing channelId' });
  }

  try {
    const params = CloseVoteParamsSchema.parse(req.params ?? {});
    const result = await closeVoteSession({ channelId, sessionId: params.sessionId });
    if (!result.session) {
      return res.status(404).json({ errorCode: ERROR_CODES.NOT_FOUND, error: 'Vote not found' });
    }

    const slug = await getChannelSlug(channelId);
    if (slug) {
      emitVoteUpdate(req.app, slug, { session: result.session });
    }

    if (result.reward && slug) {
      const io = req.app.get('io');
      const walletEvent: WalletUpdatedEvent = {
        userId: result.reward.userId,
        channelId,
        balance: result.reward.balance,
        delta: result.reward.delta,
        reason: 'vote_winner_bonus',
        channelSlug: slug,
      };
      emitWalletUpdated(io, walletEvent);
      void relayWalletUpdatedToPeer(walletEvent);
    }

    return res.json({ session: result.session });
  } catch (error: unknown) {
    return res.status(400).json({ errorCode: ERROR_CODES.BAD_REQUEST, error: 'Invalid vote close request' });
  }
};
