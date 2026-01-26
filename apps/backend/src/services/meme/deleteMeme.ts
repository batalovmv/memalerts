import type { Response } from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { prisma } from '../../lib/prisma.js';
import { assertChannelOwner } from '../../utils/accessControl.js';
import { ERROR_CODES } from '../../shared/errors.js';
import { logAdminAction } from '../../utils/auditLogger.js';
import { logger } from '../../utils/logger.js';

export const deleteMeme = async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const channelId = req.channelId;

  if (!channelId) {
    return res.status(400).json({ error: 'Channel ID required' });
  }

  try {
    const cm = await prisma.channelMeme.findUnique({ where: { id } });

    if (!cm) {
      return res
        .status(404)
        .json({ errorCode: 'CHANNEL_MEME_NOT_FOUND', error: 'Meme not found', details: { entity: 'channelMeme', id } });
    }
    const ownsChannel = await assertChannelOwner({
      userId: req.userId,
      requestChannelId: channelId,
      channelId: cm.channelId,
      res,
      notFound: { errorCode: ERROR_CODES.CHANNEL_MEME_NOT_FOUND, entity: 'channelMeme', id },
    });
    if (!ownsChannel) return;

    const now = new Date();
    const deleted = await prisma.channelMeme.update({
      where: { id: cm.id },
      data: { status: 'disabled', deletedAt: now },
      include: {
        memeAsset: {
          select: {
            id: true,
            type: true,
            fileUrl: true,
            fileHash: true,
            durationMs: true,
            createdBy: { select: { id: true, displayName: true } },
          },
        },
      },
    });

    await logAdminAction(
      'delete_meme',
      req.userId!,
      channelId,
      cm.id,
      {
        memeTitle: deleted.title,
      },
      true,
      req
    );

    res.json({
      id: deleted.id,
      channelId: deleted.channelId,
      title: deleted.title,
      type: deleted.memeAsset.type,
      fileUrl: deleted.memeAsset.fileUrl ?? null,
      durationMs: deleted.memeAsset.durationMs,
      priceCoins: deleted.priceCoins,
      status: deleted.status,
      deletedAt: deleted.deletedAt,
      createdAt: deleted.createdAt,
      createdBy: deleted.memeAsset.createdBy,
    });
  } catch (error: unknown) {
    const err = error as Error;
    logger.error('admin.memes.delete_failed', { errorMessage: err.message });
    if (!res.headersSent) {
      return res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to delete meme',
      });
    }
  }
};
