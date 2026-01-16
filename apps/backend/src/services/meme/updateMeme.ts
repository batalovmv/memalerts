import type { Response } from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { prisma } from '../../lib/prisma.js';
import { updateMemeSchema } from '../../shared/schemas.js';
import { ZodError } from 'zod';
import { assertChannelOwner } from '../../utils/accessControl.js';
import { ERROR_CODES } from '../../shared/errors.js';
import { asRecord } from './memeShared.js';

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
        memeAsset: {
          include: { createdBy: { select: { id: true, displayName: true, channel: { select: { slug: true } } } } },
        },
        approvedBy: { select: { id: true, displayName: true } },
      },
    });

    const cmByLegacy = !cm
      ? await prisma.channelMeme.findFirst({
          where: { legacyMemeId: id, channelId },
          include: {
            memeAsset: {
              include: { createdBy: { select: { id: true, displayName: true, channel: { select: { slug: true } } } } },
            },
            approvedBy: { select: { id: true, displayName: true } },
          },
        })
      : null;

    const target = cm ?? cmByLegacy;
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

    const updated = await prisma.$transaction(async (tx) => {
      const updated = await tx.channelMeme.update({
        where: { id: target.id },
        data: {
          ...(body.title !== undefined ? { title: body.title } : {}),
          ...(body.priceCoins !== undefined ? { priceCoins: body.priceCoins } : {}),
        },
        include: {
          memeAsset: {
            include: { createdBy: { select: { id: true, displayName: true, channel: { select: { slug: true } } } } },
          },
          approvedBy: { select: { id: true, displayName: true } },
        },
      });

      const legacyData = {
        channelId: updated.channelId,
        title: updated.title,
        type: updated.memeAsset.type,
        fileUrl: updated.memeAsset.playFileUrl ?? updated.memeAsset.fileUrl ?? '',
        fileHash: updated.memeAsset.fileHash,
        durationMs: updated.memeAsset.durationMs,
        priceCoins: updated.priceCoins,
        status: updated.status === 'disabled' ? 'deleted' : updated.status,
        deletedAt: updated.deletedAt,
        createdByUserId: updated.memeAsset.createdBy?.id ?? null,
        approvedByUserId: updated.approvedBy?.id ?? null,
      };

      if (updated.legacyMemeId) {
        try {
          await tx.meme.update({
            where: { id: updated.legacyMemeId },
            data: {
              ...(body.title !== undefined ? { title: body.title } : {}),
              ...(body.priceCoins !== undefined ? { priceCoins: body.priceCoins } : {}),
            },
          });
        } catch (e: unknown) {
          const errorRec = asRecord(e);
          if (errorRec.code === 'P2025') {
            const legacy = await tx.meme.create({ data: legacyData });
            await tx.channelMeme.update({
              where: { id: updated.id },
              data: { legacyMemeId: legacy.id },
            });
          } else {
            throw e;
          }
        }
      } else {
        const legacy = await tx.meme.create({ data: legacyData });
        await tx.channelMeme.update({
          where: { id: updated.id },
          data: { legacyMemeId: legacy.id },
        });
      }

      return updated;
    });

    res.json({
      id: updated.id,
      legacyMemeId: updated.legacyMemeId,
      channelId: updated.channelId,
      title: updated.title,
      type: updated.memeAsset.type,
      fileUrl: updated.memeAsset.fileUrl ?? null,
      durationMs: updated.memeAsset.durationMs,
      priceCoins: updated.priceCoins,
      status: updated.status,
      deletedAt: updated.deletedAt,
      createdAt: updated.createdAt,
      createdBy: updated.memeAsset.createdBy,
      approvedBy: updated.approvedBy,
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
