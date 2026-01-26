import type { Response } from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { prisma } from '../../lib/prisma.js';
import { updateMemeSchema } from '../../shared/schemas.js';
import { ZodError } from 'zod';
import { assertChannelOwner } from '../../utils/accessControl.js';
import { ERROR_CODES } from '../../shared/errors.js';

export const updateMeme = async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const channelId = req.channelId;

  if (!channelId) {
    return res.status(400).json({ error: 'Channel ID required' });
  }

  try {
    const body = updateMemeSchema.parse(req.body);

    const cm = await prisma.channelMeme.findUnique({
      where: { id },
      include: {
        memeAsset: { include: { createdBy: { select: { id: true, displayName: true, channel: { select: { slug: true } } } } } },
      },
    });

    const target = cm;
    if (!target) {
      return res
        .status(404)
        .json({ errorCode: 'CHANNEL_MEME_NOT_FOUND', error: 'Meme not found', details: { entity: 'channelMeme', id } });
    }
    const ownsChannel = await assertChannelOwner({
      userId: req.userId,
      requestChannelId: channelId,
      channelId: target.channelId,
      res,
      notFound: { errorCode: ERROR_CODES.CHANNEL_MEME_NOT_FOUND, entity: 'channelMeme', id },
    });
    if (!ownsChannel) return;

    const updated = await prisma.channelMeme.update({
      where: { id: target.id },
      data: {
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.priceCoins !== undefined ? { priceCoins: body.priceCoins } : {}),
        ...(body.cooldownMinutes !== undefined ? { cooldownMinutes: body.cooldownMinutes } : {}),
      },
      include: {
        memeAsset: {
          include: { createdBy: { select: { id: true, displayName: true, channel: { select: { slug: true } } } } },
        },
      },
    });

    res.json({
      id: updated.id,
      channelId: updated.channelId,
      title: updated.title,
      type: updated.memeAsset.type,
      fileUrl: updated.memeAsset.fileUrl ?? null,
      durationMs: updated.memeAsset.durationMs,
      priceCoins: updated.priceCoins,
      cooldownMinutes: updated.cooldownMinutes ?? null,
      status: updated.status,
      deletedAt: updated.deletedAt,
      createdAt: updated.createdAt,
      createdBy: updated.memeAsset.createdBy,
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return res.status(400).json({
        error: 'Validation error',
        message: 'Validation failed',
        details: error.errors,
      });
    }
    throw error;
  }
};
