import type { Response } from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { prisma } from '../../lib/prisma.js';

const getSourceType = (format: 'webm' | 'mp4' | 'preview'): string => {
  switch (format) {
    case 'preview':
      return 'video/mp4; codecs="avc1.42E01E, mp4a.40.2"';
    case 'webm':
      return 'video/webm; codecs="vp9, opus"';
    case 'mp4':
      return 'video/mp4; codecs="avc1.4d401f, mp4a.40.2"';
  }
};

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
          variants: {
            select: {
              format: true,
              fileUrl: true,
              status: true,
              priority: true,
              fileSizeBytes: true,
            },
          },
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
  const items = rows.map((r) => {
    const doneVariants = Array.isArray(r.memeAsset.variants)
      ? r.memeAsset.variants.filter((v) => String(v.status || '') === 'done')
      : [];
    const preview = doneVariants.find((v) => String(v.format || '') === 'preview');
    const variants = doneVariants
      .filter((v) => String(v.format || '') !== 'preview')
      .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0))
      .map((v) => {
        const format = (String(v.format || '') as 'webm' | 'mp4') || 'mp4';
        return {
          format,
          fileUrl: v.fileUrl,
          sourceType: getSourceType(format),
          fileSizeBytes: typeof v.fileSizeBytes === 'bigint' ? Number(v.fileSizeBytes) : null,
        };
      });
    return {
    id: r.legacyMemeId ?? r.id,
    channelMemeId: r.id,
    memeAssetId: r.memeAssetId,
    title: r.title,
    type: r.memeAsset.type,
    previewUrl: preview?.fileUrl ?? null,
    variants,
    fileUrl: variants[0]?.fileUrl ?? preview?.fileUrl ?? r.memeAsset.fileUrl,
    durationMs: r.memeAsset.durationMs,
    qualityScore: r.memeAsset.qualityScore ?? null,
    priceCoins: r.priceCoins,
    status: r.status,
    createdAt: r.createdAt,
    createdBy: r.memeAsset.createdBy,
    };
  });

  res.json(items);
};
