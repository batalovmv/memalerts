import type { Response } from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { prisma } from '../../lib/prisma.js';

async function resolveChannelBySlug(slug: string) {
  if (!slug) return null;
  return prisma.channel.findFirst({
    where: { slug: { equals: slug, mode: 'insensitive' } },
    select: { id: true, memeCatalogMode: true },
  });
}

async function ensureMemeAssetAccessible(channelId: string, memeAssetId: string, catalogMode: string) {
  if (catalogMode === 'pool_all') {
    const asset = await prisma.memeAsset.findFirst({
      where: { id: memeAssetId, status: 'active', deletedAt: null },
      select: { id: true },
    });
    return !!asset;
  }

  const channelMeme = await prisma.channelMeme.findFirst({
    where: { channelId, memeAssetId, status: 'approved', deletedAt: null },
    select: { id: true },
  });
  return !!channelMeme;
}

export const addFavorite = async (req: AuthRequest, res: Response) => {
  const slug = String(req.params.slug || '').trim();
  const memeAssetId = String(req.params.memeAssetId || '').trim();
  if (!slug || !memeAssetId) {
    return res.status(400).json({ errorCode: 'BAD_REQUEST', error: 'Bad request' });
  }
  if (!req.userId) {
    return res.status(401).json({ errorCode: 'UNAUTHORIZED', error: 'Unauthorized' });
  }

  const channel = await resolveChannelBySlug(slug);
  if (!channel) {
    return res.status(404).json({ errorCode: 'CHANNEL_NOT_FOUND', error: 'Channel not found' });
  }

  const canAccess = await ensureMemeAssetAccessible(channel.id, memeAssetId, String(channel.memeCatalogMode || 'channel'));
  if (!canAccess) {
    return res.status(404).json({ errorCode: 'MEME_NOT_FOUND', error: 'Meme not found' });
  }

  await prisma.userMemeFavorite.upsert({
    where: {
      userId_channelId_memeAssetId: { userId: req.userId, channelId: channel.id, memeAssetId },
    },
    create: { userId: req.userId, channelId: channel.id, memeAssetId },
    update: {},
  });

  return res.json({ ok: true, isFavorite: true });
};

export const removeFavorite = async (req: AuthRequest, res: Response) => {
  const slug = String(req.params.slug || '').trim();
  const memeAssetId = String(req.params.memeAssetId || '').trim();
  if (!slug || !memeAssetId) {
    return res.status(400).json({ errorCode: 'BAD_REQUEST', error: 'Bad request' });
  }
  if (!req.userId) {
    return res.status(401).json({ errorCode: 'UNAUTHORIZED', error: 'Unauthorized' });
  }

  const channel = await resolveChannelBySlug(slug);
  if (!channel) {
    return res.status(404).json({ errorCode: 'CHANNEL_NOT_FOUND', error: 'Channel not found' });
  }

  await prisma.userMemeFavorite.deleteMany({
    where: { userId: req.userId, channelId: channel.id, memeAssetId },
  });

  return res.json({ ok: true, isFavorite: false });
};

export const addHidden = async (req: AuthRequest, res: Response) => {
  const slug = String(req.params.slug || '').trim();
  const memeAssetId = String(req.params.memeAssetId || '').trim();
  if (!slug || !memeAssetId) {
    return res.status(400).json({ errorCode: 'BAD_REQUEST', error: 'Bad request' });
  }
  if (!req.userId) {
    return res.status(401).json({ errorCode: 'UNAUTHORIZED', error: 'Unauthorized' });
  }

  const channel = await resolveChannelBySlug(slug);
  if (!channel) {
    return res.status(404).json({ errorCode: 'CHANNEL_NOT_FOUND', error: 'Channel not found' });
  }

  const canAccess = await ensureMemeAssetAccessible(channel.id, memeAssetId, String(channel.memeCatalogMode || 'channel'));
  if (!canAccess) {
    return res.status(404).json({ errorCode: 'MEME_NOT_FOUND', error: 'Meme not found' });
  }

  await prisma.userMemeBlocklist.upsert({
    where: {
      userId_channelId_memeAssetId: { userId: req.userId, channelId: channel.id, memeAssetId },
    },
    create: { userId: req.userId, channelId: channel.id, memeAssetId },
    update: {},
  });

  return res.json({ ok: true, isHidden: true });
};

export const removeHidden = async (req: AuthRequest, res: Response) => {
  const slug = String(req.params.slug || '').trim();
  const memeAssetId = String(req.params.memeAssetId || '').trim();
  if (!slug || !memeAssetId) {
    return res.status(400).json({ errorCode: 'BAD_REQUEST', error: 'Bad request' });
  }
  if (!req.userId) {
    return res.status(401).json({ errorCode: 'UNAUTHORIZED', error: 'Unauthorized' });
  }

  const channel = await resolveChannelBySlug(slug);
  if (!channel) {
    return res.status(404).json({ errorCode: 'CHANNEL_NOT_FOUND', error: 'Channel not found' });
  }

  await prisma.userMemeBlocklist.deleteMany({
    where: { userId: req.userId, channelId: channel.id, memeAssetId },
  });

  return res.json({ ok: true, isHidden: false });
};
