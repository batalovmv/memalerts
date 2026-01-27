import type { Response } from 'express';
import type { AuthRequest } from '../../middleware/auth.js';

import { CastVoteBodySchema, CastVoteParamsSchema, GetActiveVoteParamsSchema } from '@memalerts/api-contracts';

import { prisma } from '../../lib/prisma.js';
import { ERROR_CODES } from '../../shared/errors.js';
import { castVote as castVoteService, getActiveVoteSession } from '../../services/vote/voteService.js';

function normalizeSlug(raw: unknown): string {
  return String(raw ?? '').trim().toLowerCase();
}

async function getChannelBySlug(slug: string) {
  return prisma.channel.findFirst({
    where: { slug: { equals: slug, mode: 'insensitive' } },
    select: { id: true, slug: true },
  });
}

function emitVoteUpdate(app: AuthRequest['app'], slug: string, payload: unknown) {
  const io = app.get('io');
  io.to(`channel:${slug}`).emit('vote:updated', payload);
  io.to(`public:${slug}`).emit('vote:updated', payload);
}

export const getActiveVote = async (req: AuthRequest, res: Response) => {
  const params = GetActiveVoteParamsSchema.parse(req.params ?? {});
  const slug = normalizeSlug(params.slug);
  const channel = await getChannelBySlug(slug);
  if (!channel) {
    return res.status(404).json({ errorCode: ERROR_CODES.CHANNEL_NOT_FOUND, error: 'Channel not found' });
  }

  const session = await getActiveVoteSession(channel.id);
  return res.json({ session });
};

export const castVoteForChannel = async (req: AuthRequest, res: Response) => {
  const params = CastVoteParamsSchema.parse({
    slug: req.params?.slug,
    sessionId: req.params?.sessionId,
  });
  const body = CastVoteBodySchema.parse(req.body ?? {});

  const slug = normalizeSlug(params.slug);
  const channel = await getChannelBySlug(slug);
  if (!channel) {
    return res.status(404).json({ errorCode: ERROR_CODES.CHANNEL_NOT_FOUND, error: 'Channel not found' });
  }

  if (!req.userId) {
    return res.status(401).json({ errorCode: ERROR_CODES.UNAUTHORIZED, error: 'Authentication required' });
  }

  const result = await castVoteService({
    channelId: channel.id,
    sessionId: params.sessionId,
    userId: req.userId,
    optionIndex: body.optionIndex,
  });

  if (!result) {
    return res.status(409).json({ errorCode: ERROR_CODES.CONFLICT, error: 'Vote is not active' });
  }

  emitVoteUpdate(req.app, channel.slug.toLowerCase(), { session: result.session });

  return res.json(result);
};

// Back-compat alias used by legacy routes.
export const castVote = castVoteForChannel;
