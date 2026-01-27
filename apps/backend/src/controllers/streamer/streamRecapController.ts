import type { Response } from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { prisma } from '../../lib/prisma.js';

type AssetVariant = { format: string; fileUrl: string; status: string; priority: number | null };

function pickBestFileUrl(asset: { fileUrl: string | null; variants?: AssetVariant[] | null }): string | null {
  const variants = Array.isArray(asset.variants) ? asset.variants : [];
  const done = variants.filter((v) => String(v.status || '') === 'done' && v.fileUrl);
  if (done.length === 0) return asset.fileUrl ?? null;
  const sorted = [...done].sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
  return sorted[0]?.fileUrl ?? asset.fileUrl ?? null;
}

function pickPreviewUrl(asset: { variants?: AssetVariant[] | null }): string | null {
  const variants = Array.isArray(asset.variants) ? asset.variants : [];
  const preview = variants.find((v) => String(v.status || '') === 'done' && String(v.format || '') === 'preview');
  return preview?.fileUrl ?? null;
}

export const getLatestStreamRecap = async (req: AuthRequest, res: Response) => {
  const channelId = req.channelId;
  if (!channelId) {
    return res.status(400).json({ error: 'Channel ID required' });
  }

  const session = await prisma.streamSession.findFirst({
    where: { channelId },
    orderBy: { startedAt: 'desc' },
  });

  if (!session) {
    return res.json({ recap: null });
  }

  const start = session.startedAt;
  const end = session.endedAt ?? new Date();

  const activationWhere = {
    channelId,
    status: 'done',
    OR: [
      { completedAt: { gte: start, lte: end } },
      { completedAt: null, createdAt: { gte: start, lte: end } },
    ],
  } as const;

  const [totalActivations, uniqueViewers, coinsAgg] = await Promise.all([
    prisma.memeActivation.count({ where: activationWhere }),
    prisma.memeActivation.count({ where: activationWhere, distinct: ['userId'] }),
    prisma.memeActivation.aggregate({ where: activationWhere, _sum: { priceCoins: true } }),
  ]);

  const topMemeAgg = await prisma.memeActivation.groupBy({
    by: ['channelMemeId'],
    where: activationWhere,
    _count: { _all: true },
    _sum: { priceCoins: true },
    orderBy: [{ _count: { _all: 'desc' } }, { _sum: { priceCoins: 'desc' } }],
    take: 5,
  });

  const topMemeIds = topMemeAgg.map((row) => row.channelMemeId);
  const memeRows = topMemeIds.length
    ? await prisma.channelMeme.findMany({
        where: { id: { in: topMemeIds } },
        select: {
          id: true,
          title: true,
          priceCoins: true,
          memeAsset: {
            select: {
              fileUrl: true,
              variants: { select: { format: true, fileUrl: true, status: true, priority: true } },
            },
          },
        },
      })
    : [];
  const memeById = new Map(memeRows.map((row) => [row.id, row]));

  const topMemes = topMemeAgg.map((row) => {
    const meme = memeById.get(row.channelMemeId);
    const asset = meme?.memeAsset;
    return {
      id: row.channelMemeId,
      title: meme?.title ?? 'Unknown meme',
      priceCoins: meme?.priceCoins ?? 0,
      fileUrl: asset ? pickBestFileUrl(asset) : null,
      previewUrl: asset ? pickPreviewUrl(asset) : null,
      activations: row._count._all,
      coinsSpent: Number(row._sum.priceCoins ?? 0),
    };
  });

  const topViewerAgg = await prisma.memeActivation.groupBy({
    by: ['userId'],
    where: activationWhere,
    _count: { _all: true },
    _sum: { priceCoins: true },
    orderBy: [{ _sum: { priceCoins: 'desc' } }, { _count: { _all: 'desc' } }],
    take: 5,
  });
  const viewerIds = topViewerAgg.map((row) => row.userId);
  const viewerRows = viewerIds.length
    ? await prisma.user.findMany({
        where: { id: { in: viewerIds } },
        select: { id: true, displayName: true, profileImageUrl: true },
      })
    : [];
  const viewerById = new Map(viewerRows.map((row) => [row.id, row]));

  const topViewers = topViewerAgg.map((row) => {
    const viewer = viewerById.get(row.userId);
    return {
      userId: row.userId,
      displayName: viewer?.displayName ?? 'Viewer',
      profileImageUrl: viewer?.profileImageUrl ?? null,
      activations: row._count._all,
      coinsSpent: Number(row._sum.priceCoins ?? 0),
    };
  });

  const newMemesRows = await prisma.channelMeme.findMany({
    where: { channelId, createdAt: { gte: start, lte: end } },
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: {
      id: true,
      title: true,
      priceCoins: true,
      createdAt: true,
      memeAsset: {
        select: {
          fileUrl: true,
          variants: { select: { format: true, fileUrl: true, status: true, priority: true } },
        },
      },
    },
  });

  const newMemes = newMemesRows.map((row) => ({
    id: row.id,
    title: row.title,
    priceCoins: row.priceCoins,
    fileUrl: pickBestFileUrl(row.memeAsset),
    previewUrl: pickPreviewUrl(row.memeAsset),
    createdAt: row.createdAt.toISOString(),
  }));

  return res.json({
    recap: {
      session: {
        id: session.id,
        startedAt: session.startedAt.toISOString(),
        endedAt: session.endedAt ? session.endedAt.toISOString() : null,
        provider: session.provider,
      },
      summary: {
        totalActivations,
        uniqueViewers,
        coinsSpent: Number(coinsAgg._sum.priceCoins ?? 0),
      },
      topMemes,
      topViewers,
      newMemes,
    },
  });
};
