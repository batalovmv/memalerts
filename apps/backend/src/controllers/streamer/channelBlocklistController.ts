import type { Response } from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { prisma } from '../../lib/prisma.js';

function resolveChannelId(req: AuthRequest): string | null {
  if (req.channelId) return String(req.channelId);
  if (String(req.userRole || '') === 'admin') {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const query = (req.query ?? {}) as Record<string, unknown>;
    const id = typeof body.channelId === 'string' ? body.channelId : typeof query.channelId === 'string' ? query.channelId : '';
    return id || null;
  }
  return null;
}

export const listChannelBlocklist = async (req: AuthRequest, res: Response) => {
  const channelId = resolveChannelId(req);
  if (!channelId) {
    return res.status(400).json({ errorCode: 'BAD_REQUEST', error: 'Channel id is required' });
  }

  const rows = await prisma.channelMemeBlocklist.findMany({
    where: { channelId },
    orderBy: { createdAt: 'desc' },
    select: {
      memeAssetId: true,
      createdAt: true,
      createdByUserId: true,
      reason: true,
    },
  });
  return res.json({ items: rows });
};

export const addChannelBlocklist = async (req: AuthRequest, res: Response) => {
  const channelId = resolveChannelId(req);
  const body = (req.body ?? {}) as Record<string, unknown>;
  const memeAssetId = typeof body.memeAssetId === 'string' ? body.memeAssetId.trim() : '';
  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) : null;

  if (!channelId || !memeAssetId) {
    return res.status(400).json({ errorCode: 'BAD_REQUEST', error: 'memeAssetId is required' });
  }

  await prisma.channelMemeBlocklist.upsert({
    where: { channelId_memeAssetId: { channelId, memeAssetId } },
    create: {
      channelId,
      memeAssetId,
      createdByUserId: req.userId ?? null,
      reason,
    },
    update: {
      createdByUserId: req.userId ?? null,
      reason,
    },
  });

  return res.json({ ok: true, channelId, memeAssetId, blocked: true });
};

export const removeChannelBlocklist = async (req: AuthRequest, res: Response) => {
  const channelId = resolveChannelId(req);
  const memeAssetId = String(req.params.memeAssetId || '').trim();
  if (!channelId || !memeAssetId) {
    return res.status(400).json({ errorCode: 'BAD_REQUEST', error: 'memeAssetId is required' });
  }

  await prisma.channelMemeBlocklist.deleteMany({
    where: { channelId, memeAssetId },
  });

  return res.json({ ok: true, channelId, memeAssetId, blocked: false });
};
