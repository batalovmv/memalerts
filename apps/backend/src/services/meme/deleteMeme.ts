import type { Response } from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { prisma } from '../../lib/prisma.js';
import { assertChannelOwner } from '../../utils/accessControl.js';
import { ERROR_CODES } from '../../shared/errors.js';
import { logAdminAction } from '../../utils/auditLogger.js';
import { logger } from '../../utils/logger.js';
import { asRecord } from './memeShared.js';

export const deleteMeme = async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const channelId = req.channelId;

  if (!channelId) {
    return res.status(400).json({ error: 'Channel ID required' });
  }

  try {
    const cm =
      (await prisma.channelMeme.findUnique({ where: { id } })) ??
      (await prisma.channelMeme.findFirst({ where: { legacyMemeId: id, channelId } }));

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
    const deleted = await prisma.$transaction(async (tx) => {
      const deleted = await tx.channelMeme.update({
        where: { id: cm.id },
        data: { status: 'disabled', deletedAt: now },
        include: {
          memeAsset: {
            select: {
              id: true,
              type: true,
              fileUrl: true,
              playFileUrl: true,
              fileHash: true,
              durationMs: true,
              createdBy: {
                select: {
                  id: true,
                  displayName: true,
                },
              },
            },
          },
        },
      });

      const legacyData = {
        channelId: deleted.channelId,
        title: deleted.title,
        type: deleted.memeAsset.type,
        fileUrl: deleted.memeAsset.playFileUrl ?? deleted.memeAsset.fileUrl ?? '',
        fileHash: deleted.memeAsset.fileHash,
        durationMs: deleted.memeAsset.durationMs,
        priceCoins: deleted.priceCoins,
        status: 'deleted',
        deletedAt: now,
        createdByUserId: deleted.memeAsset.createdBy?.id ?? null,
        approvedByUserId: deleted.approvedByUserId ?? null,
      };

      if (deleted.legacyMemeId) {
        try {
          await tx.meme.update({
            where: { id: deleted.legacyMemeId },
            data: {
              status: 'deleted',
              deletedAt: now,
            },
          });
        } catch (e: unknown) {
          const errorRec = asRecord(e);
          if (errorRec.code === 'P2025') {
            const legacy = await tx.meme.create({ data: legacyData });
            await tx.channelMeme.update({
              where: { id: deleted.id },
              data: { legacyMemeId: legacy.id },
            });
          } else {
            throw e;
          }
        }
      } else {
        const legacy = await tx.meme.create({ data: legacyData });
        await tx.channelMeme.update({
          where: { id: deleted.id },
          data: { legacyMemeId: legacy.id },
        });
      }

      return deleted;
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
      legacyMemeId: deleted.legacyMemeId,
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
