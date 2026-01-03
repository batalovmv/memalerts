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

  const rows = await prisma.channelMeme.findMany({
    where: {
      channelId: targetChannelId,
      status: 'approved',
      deletedAt: null,
    },
    include: {
      memeAsset: {
        include: {
          createdBy: {
            select: {
              id: true,
              displayName: true,
            },
          },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    ...(limit !== undefined && { take: limit }),
    ...(offset !== undefined && { skip: offset }),
  });

  // Back-compat: keep legacy `id` when available so existing activation paths using Meme.id continue to work.
  const items = rows.map((r) => ({
    id: r.legacyMemeId ?? r.id,
    channelMemeId: r.id,
    memeAssetId: r.memeAssetId,
    title: r.title,
    type: r.memeAsset.type,
    fileUrl: (r.memeAsset as any).playFileUrl ?? r.memeAsset.fileUrl,
    durationMs: r.memeAsset.durationMs,
    priceCoins: r.priceCoins,
    status: r.status,
    createdAt: r.createdAt,
    createdBy: r.memeAsset.createdBy,
  }));

  res.json(items);
};


