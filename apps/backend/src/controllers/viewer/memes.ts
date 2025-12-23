import type { Response } from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { prisma } from '../../lib/prisma.js';

export const getMemes = async (req: AuthRequest, res: Response) => {
  const channelSlug = req.query.channelSlug as string | undefined;
  const channelId = req.channelId || (req.query.channelId as string | undefined);
  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
  const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : undefined;

  let targetChannelId: string | null = null;

  if (channelSlug) {
    const channel = await prisma.channel.findUnique({
      where: { slug: channelSlug },
      select: { id: true },
    });
    if (!channel) {
      return res.status(404).json({ error: 'Channel not found' });
    }
    targetChannelId = channel.id;
  } else if (channelId) {
    targetChannelId = channelId;
  } else {
    return res.status(400).json({ error: 'Channel ID or slug required' });
  }

  const memes = await prisma.meme.findMany({
    where: {
      channelId: targetChannelId,
      status: 'approved',
      deletedAt: null,
    },
    include: {
      createdBy: {
        select: {
          id: true,
          displayName: true,
        },
      },
    },
    orderBy: {
      createdAt: 'desc',
    },
    ...(limit !== undefined && { take: limit }),
    ...(offset !== undefined && { skip: offset }),
  });

  res.json(memes);
};


